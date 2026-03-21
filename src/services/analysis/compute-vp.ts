import type { Candle } from "../../domain/market/candle.js";
import type { VolumeProfile, VPBucket, PriceZone } from "../../domain/market/volume-profile.js";

/**
 * Volume Profile 计算器  (PHASE_17)
 *
 * 第一性原理：
 *   成交量在每个价格区间的分布揭示了机构真实的建仓/平仓区域。
 *   高成交量 = 大量订单在此成交 = 双方都接受此价格（公允价值区）。
 *   低成交量 = 价格快速穿越 = 单方向快速移动（价格真空带）。
 *
 * 算法说明（等量桶，均匀分布法）：
 *   1. 以所有 K 线的 [low, high] 确定价格区间，分割为 bucketCount 个等宽桶。
 *   2. 每根 K 线的成交量按其 high-low 与各桶的重叠比例均匀分配。
 *      （更精确的做法是按 tick 数据分配，此处采用工程近似，精度足够用于日线分析。）
 *   3. VPOC = 成交量最大的桶的中间价。
 *   4. 价值区间（Value Area）= 从 VPOC 向两侧扩展，累计覆盖 valueAreaPercent 的成交量。
 *   5. HVN = 超过均值 + 1×stddev 的高密度节点；LVN = 低于均值 - 0.5×stddev 的低密度节点。
 */

/** computeVolumeProfile 配置参数 */
export type VPOptions = {
  /** 等宽价格桶数量（默认 200），越多精度越高但计算量越大 */
  bucketCount?: number;
  /** 价值区间覆盖比例（默认 0.70 = 70%） */
  valueAreaPercent?: number;
};

/**
 * 根据 K 线列表计算 Volume Profile。
 *
 * @param candles       K 线数组（时间顺序，chronological）
 * @param options       可选配置
 * @returns             VolumeProfile 或 null（K 线不足 / 价格区间为零时）
 */
export function computeVolumeProfile(
  candles: Candle[],
  options: VPOptions = {},
): VolumeProfile | null {
  if (candles.length === 0) return null;

  const { bucketCount = 200, valueAreaPercent = 0.70 } = options;

  // ── 步骤 1: 确定价格区间 ────────────────────────────────────────────────────
  let priceMin = Infinity;
  let priceMax = -Infinity;
  for (const c of candles) {
    if (c.low  < priceMin) priceMin = c.low;
    if (c.high > priceMax) priceMax = c.high;
  }

  if (priceMax <= priceMin) return null; // 价格区间为零（极端情况）

  const bucketSize = (priceMax - priceMin) / bucketCount;

  // ── 步骤 2: 初始化桶 ────────────────────────────────────────────────────────
  const volumes = new Float64Array(bucketCount); // 每个桶的成交量

  // ── 步骤 3: 将每根 K 线的成交量按重叠比例分配到对应桶 ─────────────────────
  for (const c of candles) {
    const range = c.high - c.low;
    if (range <= 0 || c.volume <= 0) continue;

    // 找出与该 K 线 [low, high] 有重叠的桶索引范围
    const startBucket = Math.max(0, Math.floor((c.low - priceMin) / bucketSize));
    const endBucket   = Math.min(bucketCount - 1, Math.floor((c.high - priceMin) / bucketSize));

    for (let b = startBucket; b <= endBucket; b++) {
      const bucketLow  = priceMin + b * bucketSize;
      const bucketHigh = bucketLow + bucketSize;

      // 重叠区间
      const overlapLow  = Math.max(bucketLow,  c.low);
      const overlapHigh = Math.min(bucketHigh, c.high);
      const overlap     = overlapHigh - overlapLow;

      if (overlap > 0) {
        volumes[b] += c.volume * (overlap / range);
      }
    }
  }

  // ── 步骤 4: 构建桶结构 ──────────────────────────────────────────────────────
  const buckets: VPBucket[] = [];
  let totalVolume = 0;
  let vpocIndex = 0;

  for (let b = 0; b < bucketCount; b++) {
    const priceLow  = priceMin + b * bucketSize;
    const priceHigh = priceLow + bucketSize;
    const volume    = volumes[b];
    buckets.push({
      priceLow,
      priceHigh,
      priceMid: (priceLow + priceHigh) / 2,
      volume,
    });
    totalVolume += volume;
    if (volume > volumes[vpocIndex]) vpocIndex = b;
  }

  const vpoc = buckets[vpocIndex].priceMid;

  // ── 步骤 5: 价值区间（Value Area）──────────────────────────────────────────
  // 从 VPOC 向两侧扩展，每次选择体积更大的邻居桶，直到覆盖目标比例
  const targetVolume = totalVolume * valueAreaPercent;
  let accumulated = volumes[vpocIndex];
  let loIdx = vpocIndex;
  let hiIdx = vpocIndex;

  while (accumulated < targetVolume) {
    const canExpandLow  = loIdx > 0;
    const canExpandHigh = hiIdx < bucketCount - 1;

    if (!canExpandLow && !canExpandHigh) break;

    const nextLoVol = canExpandLow  ? volumes[loIdx - 1] : -1;
    const nextHiVol = canExpandHigh ? volumes[hiIdx + 1] : -1;

    if (nextLoVol >= nextHiVol) {
      loIdx--;
      accumulated += volumes[loIdx];
    } else {
      hiIdx++;
      accumulated += volumes[hiIdx];
    }
  }

  const val = buckets[loIdx].priceLow;
  const vah = buckets[hiIdx].priceHigh;

  // ── 步骤 6: HVN / LVN 识别 ─────────────────────────────────────────────────
  // 仅考虑有成交量的桶，计算均值和标准差
  const nonZero = volumes.filter(v => v > 0);
  const mean = nonZero.length > 0
    ? nonZero.reduce((a, b) => a + b, 0) / nonZero.length
    : 0;
  const variance = nonZero.length > 0
    ? nonZero.reduce((s, v) => s + (v - mean) ** 2, 0) / nonZero.length
    : 0;
  const stddev = Math.sqrt(variance);

  const hvnThreshold = mean + stddev;        // 超过此值 = 高密度节点
  const lvnThreshold = mean - 0.5 * stddev;  // 低于此值（且 > 0）= 低密度节点

  const hvn: number[] = [];
  const lvn: number[] = [];

  for (const b of buckets) {
    if (b.volume > hvnThreshold) hvn.push(b.priceMid);
    else if (b.volume > 0 && b.volume < lvnThreshold) lvn.push(b.priceMid);
  }

  return { vpoc, vah, val, hvn, lvn, totalVolume, buckets, priceMin, priceMax };
}

/**
 * 根据最新收盘价与 Volume Profile 的位置关系，判断价格区域。
 *
 *   premium    — close > VAH（价格在价值区间上方，溢价）
 *   discount   — close < VAL（价格在价值区间下方，折价）
 *   equilibrium — VAL ≤ close ≤ VAH（价格在价值区间内，均衡）
 */
export function getPriceZone(
  latestClose: number,
  vah: number,
  val: number,
): PriceZone {
  if (latestClose > vah) return "premium";
  if (latestClose < val) return "discount";
  return "equilibrium";
}

/**
 * 找出距离给定价格最近的 HVN（高成交量节点）。
 * 返回 null 表示 hvn 列表为空。
 */
export function nearestHVN(price: number, hvn: number[]): number | null {
  if (hvn.length === 0) return null;
  return hvn.reduce((nearest, h) =>
    Math.abs(h - price) < Math.abs(nearest - price) ? h : nearest
  );
}

/**
 * 找出距离给定价格最近的 LVN（低成交量节点）。
 * 返回 null 表示 lvn 列表为空。
 */
export function nearestLVN(price: number, lvn: number[]): number | null {
  if (lvn.length === 0) return null;
  return lvn.reduce((nearest, l) =>
    Math.abs(l - price) < Math.abs(nearest - price) ? l : nearest
  );
}

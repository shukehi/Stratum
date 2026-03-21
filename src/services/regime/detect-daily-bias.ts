import type { Candle } from "../../domain/market/candle.js";
import type { DailyBias, DailyBiasResult, PriceZone } from "../../domain/market/daily-bias.js";
import { computeVolumeProfile, getPriceZone } from "../analysis/compute-vp.js";

/**
 * 日线偏向检测器  (PHASE_17 — Volume Profile 版本)
 *
 * 第一性原理：
 *   不使用滞后指标（EMA）或时间相关结构（摆高/摆低），
 *   而是直接读取成交量在价格区间的分布——这是机构建仓行为的真实反映。
 *
 * 判断逻辑（顺序应用）：
 *   数据不足（< vpLookbackDays 根）→ neutral（信息不足，不干扰信号）
 *   Volume Profile 计算失败       → neutral（极端情况保护）
 *   close > VAH                  → bearish（溢价区，价格偏贵，倾向回归）
 *   close < VAL                  → bullish（折价区，价格偏便宜，倾向回归）
 *   VAL ≤ close ≤ VAH            → neutral（均衡区，双方都接受此价格）
 *
 * 参数说明：
 *   vpLookbackDays（默认 30）
 *     用于计算 Volume Profile 的日线 K 线数量。
 *     30 根 ≈ 1 个月，捕捉近期机构建仓区域。
 *     太长（> 90 根）会稀释近期成交量的信号意义；
 *     太短（< 15 根）统计样本不足，VPOC 不稳定。
 *
 *   vpBucketCount（默认 200）
 *     价格区间分桶数量。200 桶在 BTC 这样宽幅资产上约每桶 200~500 美元，
 *     精度足够识别机构关键成交区间。
 *
 *   vpValueAreaPercent（默认 0.70 = 70%）
 *     价值区间覆盖比例，遵循市场剖析（Market Profile）70% 惯例。
 */
export function detectDailyBias(
  candles1d: Candle[],
  vpLookbackDays = 30,
  vpBucketCount = 200,
  vpValueAreaPercent = 0.70,
): DailyBiasResult {
  const latestClose = candles1d.at(-1)?.close ?? 0;

  // 数据不足保护
  if (candles1d.length < vpLookbackDays) {
    return {
      bias: "neutral",
      priceZone: "equilibrium",
      vpoc: latestClose,
      vah: latestClose,
      val: latestClose,
      latestClose,
      reason: `日线数据不足（当前 ${candles1d.length} 根，需要至少 ${vpLookbackDays} 根），默认中性`,
    };
  }

  // 取最近 vpLookbackDays 根 K 线计算 Volume Profile
  const recentCandles = candles1d.slice(-vpLookbackDays);

  const vp = computeVolumeProfile(recentCandles, {
    bucketCount: vpBucketCount,
    valueAreaPercent: vpValueAreaPercent,
  });

  // VP 计算失败（极端情况：价格区间为零）
  if (!vp) {
    return {
      bias: "neutral",
      priceZone: "equilibrium",
      vpoc: latestClose,
      vah: latestClose,
      val: latestClose,
      latestClose,
      reason: "Volume Profile 计算失败（价格区间为零），默认中性",
    };
  }

  const { vpoc, vah, val } = vp;
  const priceZone: PriceZone = getPriceZone(latestClose, vah, val);

  const bias: DailyBias =
    priceZone === "premium"  ? "bearish" :
    priceZone === "discount" ? "bullish" :
    "neutral";

  const zoneLabel: Record<PriceZone, string> = {
    premium:     `溢价区（收盘 ${latestClose.toFixed(0)} > VAH ${vah.toFixed(0)}），价格偏贵，偏空`,
    equilibrium: `均衡区（VAL ${val.toFixed(0)} ≤ 收盘 ${latestClose.toFixed(0)} ≤ VAH ${vah.toFixed(0)}），双向中性`,
    discount:    `折价区（收盘 ${latestClose.toFixed(0)} < VAL ${val.toFixed(0)}），价格偏便宜，偏多`,
  };

  return {
    bias,
    priceZone,
    vpoc,
    vah,
    val,
    latestClose,
    reason: `VPOC ${vpoc.toFixed(0)} | ${zoneLabel[priceZone]}（近 ${vpLookbackDays} 根日线 Volume Profile）`,
  };
}

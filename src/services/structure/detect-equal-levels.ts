import type { Candle } from "../../domain/market/candle.js";
import type { EqualLevel } from "../../domain/market/equal-level.js";

/**
 * 等高等低（Equal Highs / Equal Lows）检测  (PHASE_19)
 *
 * 算法（两步法）:
 *   Step 1 — 识别 Swing 极值
 *     使用对称窗口（lookback 根）识别局部高/低点，
 *     仅考虑严格大于/小于两侧所有邻居的极值。
 *
 *   Step 2 — 价格聚类
 *     将 swing 极值按价格升序排列，用固定锚点分组：
 *       当 (currentPrice - groupAnchor) / groupAnchor ≤ tolerance 时，
 *       归入同一组；否则开始新组。
 *     touchCount ≥ minCount 的组 → EqualLevel。
 *
 * 容差语义:
 *   tolerance = 0.001 表示 0.1% 的价格容差。
 *   对于 BTC ≈ 50,000，容差约为 ±50 USDT。
 *   容差越小 → 识别越严格（减少假等高等低）。
 *
 * 锚点选择：
 *   组内最低价作为锚点（sortedAsc[0]），后续元素与锚点对比。
 *   代表价格 = 组内所有触碰价格的均值。
 */

/**
 * 检测序列中的等高（Equal Highs）区域。
 *
 * @param candles       K 线数组（时间升序）
 * @param tolerance     价格容差比例（默认 0.001 = 0.1%）
 * @param minCount      最少触碰次数（默认 2）
 * @param swingLookback swing 高点识别的左右对称窗口（默认 2）
 * @returns             EqualLevel[]（type 固定为 "high"）
 */
export function detectEqualHighs(
  candles: Candle[],
  tolerance = 0.001,
  minCount = 2,
  swingLookback = 2,
): EqualLevel[] {
  return detectEqualLevelsInternal(candles, "high", tolerance, minCount, swingLookback);
}

/**
 * 检测序列中的等低（Equal Lows）区域。
 *
 * @param candles       K 线数组（时间升序）
 * @param tolerance     价格容差比例（默认 0.001 = 0.1%）
 * @param minCount      最少触碰次数（默认 2）
 * @param swingLookback swing 低点识别的左右对称窗口（默认 2）
 * @returns             EqualLevel[]（type 固定为 "low"）
 */
export function detectEqualLows(
  candles: Candle[],
  tolerance = 0.001,
  minCount = 2,
  swingLookback = 2,
): EqualLevel[] {
  return detectEqualLevelsInternal(candles, "low", tolerance, minCount, swingLookback);
}

// ── 内部实现 ───────────────────────────────────────────────────────────────────

type LevelType = "high" | "low";
type SwingPoint = { price: number; timestamp: number };

/**
 * 内部通用实现：识别 swing 极值后进行价格聚类。
 */
function detectEqualLevelsInternal(
  candles: Candle[],
  type: LevelType,
  tolerance: number,
  minCount: number,
  swingLookback: number,
): EqualLevel[] {
  // 至少需要 2×lookback+1 根 K 线才能识别出 swing 点
  if (candles.length < swingLookback * 2 + 1) return [];

  // ── Step 1: 识别 swing 极值 ─────────────────────────────────────────────
  const swingPoints = extractSwingPoints(candles, type, swingLookback);
  if (swingPoints.length < minCount) return [];

  // ── Step 2: 按价格升序排列后分组（固定锚点法）───────────────────────────
  const sorted = [...swingPoints].sort((a, b) => a.price - b.price);
  const groups: SwingPoint[][] = [];
  let currentGroup: SwingPoint[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const anchor = currentGroup[0].price; // 固定锚点：组内最低价
    const deviation = (sorted[i].price - anchor) / anchor;

    if (deviation <= tolerance) {
      currentGroup.push(sorted[i]);
    } else {
      groups.push(currentGroup);
      currentGroup = [sorted[i]];
    }
  }
  groups.push(currentGroup);

  // ── Step 3: 过滤 + 构建 EqualLevel ──────────────────────────────────────
  return groups
    .filter(g => g.length >= minCount)
    .map(g => {
      const avgPrice = g.reduce((s, p) => s + p.price, 0) / g.length;
      const timestamps = g.map(p => p.timestamp).sort((a, b) => a - b);
      return {
        type,
        price: avgPrice,
        touchCount: g.length,
        firstTimestamp: timestamps[0],
        lastTimestamp: timestamps[timestamps.length - 1],
        toleranceAbsolute: avgPrice * tolerance,
      };
    });
}

/**
 * 提取局部极值 swing 点（严格单调：邻居均不超过该点）。
 *
 * Swing High: c[i].high > c[i±j].high  (j = 1..lookback, 全部严格大于)
 * Swing Low:  c[i].low  < c[i±j].low   (j = 1..lookback, 全部严格小于)
 */
function extractSwingPoints(
  candles: Candle[],
  type: LevelType,
  lookback: number,
): SwingPoint[] {
  const points: SwingPoint[] = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i];
    let isExtreme = true;

    for (let j = 1; j <= lookback; j++) {
      if (type === "high") {
        if (candles[i - j].high >= c.high || candles[i + j].high >= c.high) {
          isExtreme = false;
          break;
        }
      } else {
        if (candles[i - j].low <= c.low || candles[i + j].low <= c.low) {
          isExtreme = false;
          break;
        }
      }
    }

    if (isExtreme) {
      const price = type === "high" ? c.high : c.low;
      points.push({ price, timestamp: c.timestamp });
    }
  }

  return points;
}

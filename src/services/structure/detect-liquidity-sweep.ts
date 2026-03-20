import type { Candle } from "../../domain/market/candle.js";
import type { StructuralSetup } from "../../domain/signal/structural-setup.js";
import type { StrategyConfig } from "../../app/config.js";
import { clamp } from "../../utils/math.js";

/**
 * Swing 高点/低点类型
 */
export type SwingPoint = {
  index: number;   // 在原始 candles 数组中的索引
  price: number;   // 低点价格 or 高点价格
  type: "low" | "high";
};

/**
 * 识别 Swing 高低点（N 根左右对称局部极值）
 *
 * 条件:
 *   Swing Low: c[i].low < c[i-j].low && c[i].low < c[i+j].low  (j = 1..lookback)
 *   Swing High: c[i].high > c[i-j].high && c[i].high > c[i+j].high
 *
 * @param lookback 左右各比较的 K 线数量（默认 3）
 */
export function detectSwingPoints(candles: Candle[], lookback = 3): SwingPoint[] {
  const points: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i];
    let isSwingLow = true;
    let isSwingHigh = true;

    for (let j = 1; j <= lookback; j++) {
      if (candles[i - j].low < c.low || candles[i + j].low < c.low) {
        isSwingLow = false;
      }
      if (candles[i - j].high > c.high || candles[i + j].high > c.high) {
        isSwingHigh = false;
      }
    }

    if (isSwingLow) points.push({ index: i, price: c.low, type: "low" });
    if (isSwingHigh) points.push({ index: i, price: c.high, type: "high" });
  }
  return points;
}

/**
 * 流动性扫描检测 (Liquidity Sweep)  (PHASE_05)
 *
 * 触发条件（4h 收盘确认，严格区分于 FVG 回踩）:
 *   看涨扫描: 最近 K 线低价穿透前期 swing low，且 4h 收盘价回到 swing low 之上
 *   看跌扫描: 最近 K 线高价穿透前期 swing high，且 4h 收盘价回到 swing high 之下
 *
 * 无效情形（直接跳过，不生成 setup）:
 *   穿透 swing low 但收盘仍在 swing low 之下 → LIQUIDITY_SWEEP_REJECTED
 *
 * 第一性原理: 止损单堆积在前期 swing 高低点附近，流动性扫描是庄家
 * 触发这些止损后反向建仓的行为。收盘确认是关键——只有价格主动
 * 收回原 swing 水平才说明扫描完成、方向已定。
 *
 * 扫描检测窗口: 最近 sweepWindow 根 K 线（默认 5）作为候选扫描 K 线；
 * swing 点从更早的 candles 中识别，不与扫描 K 线重叠。
 */
export function detectLiquiditySweep(
  candles: Candle[],
  config: StrategyConfig,
  sweepWindow = 5
): StructuralSetup[] {
  if (candles.length < 10) return [];

  const results: StructuralSetup[] = [];

  // 基准 ATR
  const baselineAtr =
    candles.slice(-50).reduce((sum, c) => sum + (c.high - c.low), 0) /
      Math.min(50, candles.length) || 1;

  // swing 点从 sweepWindow 之前的 K 线中识别（不与候选扫描 K 线重叠）
  const swingCandles = candles.slice(0, -(sweepWindow));
  if (swingCandles.length < 6) return [];

  const swingPoints = detectSwingPoints(swingCandles);
  const recentCandles = candles.slice(-sweepWindow);

  for (const swing of swingPoints) {
    // ── 看涨扫描（sweep of swing low）──────────────────────────────────────
    if (swing.type === "low") {
      // 找到第一根穿透该 swing low 的 K 线
      const sweepCandle = recentCandles.find(c => c.low < swing.price);
      if (!sweepCandle) continue;

      // 4h 收盘确认: 收盘必须回到 swing low 之上（否则为无效扫描，跳过）
      if (sweepCandle.close <= swing.price) continue;

      const sweepDepth = swing.price - sweepCandle.low; // 穿透深度
      const entryLow = sweepCandle.low;
      const entryHigh = swing.price;
      const stopLossHint = entryLow - sweepDepth * 0.3;
      const riskDist = entryHigh - stopLossHint;
      const takeProfitHint = entryHigh + riskDist * config.minimumRiskReward;

      const sweepRatio = sweepDepth / baselineAtr;
      const structureScore = clamp(Math.round(65 + sweepRatio * 20), 0, 100);

      results.push({
        timeframe: config.liquiditySweepConfirmationTimeframe,
        direction: "long",
        entryLow,
        entryHigh,
        stopLossHint,
        takeProfitHint,
        structureScore,
        structureReason:
          `看涨流动性扫描: 刺破swing low ${swing.price.toFixed(0)}, ` +
          `4h收回 (sweep=${(sweepRatio * 100).toFixed(1)}%ATR)`,
        invalidationReason: `1h收盘跌破 ${stopLossHint.toFixed(0)}`,
        confluenceFactors: ["liquidity-sweep"],
        confirmationStatus: "pending",
        confirmationTimeframe: "1h",
        reasonCodes: ["LIQUIDITY_SWEEP_CONFIRMED", "STRUCTURE_CONFIRMATION_PENDING"],
      });
    }

    // ── 看跌扫描（sweep of swing high）─────────────────────────────────────
    if (swing.type === "high") {
      const sweepCandle = recentCandles.find(c => c.high > swing.price);
      if (!sweepCandle) continue;

      // 4h 收盘确认: 收盘必须回到 swing high 之下（否则为无效扫描，跳过）
      if (sweepCandle.close >= swing.price) continue;

      const sweepDepth = sweepCandle.high - swing.price;
      const entryHigh = sweepCandle.high;
      const entryLow = swing.price;
      const stopLossHint = entryHigh + sweepDepth * 0.3;
      const riskDist = stopLossHint - entryLow;
      const takeProfitHint = entryLow - riskDist * config.minimumRiskReward;

      const sweepRatio = sweepDepth / baselineAtr;
      const structureScore = clamp(Math.round(65 + sweepRatio * 20), 0, 100);

      results.push({
        timeframe: config.liquiditySweepConfirmationTimeframe,
        direction: "short",
        entryLow,
        entryHigh,
        stopLossHint,
        takeProfitHint,
        structureScore,
        structureReason:
          `看跌流动性扫描: 刺破swing high ${swing.price.toFixed(0)}, ` +
          `4h收回 (sweep=${(sweepRatio * 100).toFixed(1)}%ATR)`,
        invalidationReason: `1h收盘涨破 ${stopLossHint.toFixed(0)}`,
        confluenceFactors: ["liquidity-sweep"],
        confirmationStatus: "pending",
        confirmationTimeframe: "1h",
        reasonCodes: ["LIQUIDITY_SWEEP_CONFIRMED", "STRUCTURE_CONFIRMATION_PENDING"],
      });
    }
  }

  return results;
}

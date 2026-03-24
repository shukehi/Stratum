import type { Candle } from "../../domain/market/candle.js";
import type { OpenInterestPoint } from "../../domain/market/open-interest.js";
import type { StructuralSetup } from "../../domain/signal/structural-setup.js";
import type { StrategyConfig } from "../../app/config.js";
import { clamp } from "../../utils/math.js";
import { detectOiCrash } from "../analysis/detect-oi-crash.js";

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
 * Sweep 深度非线性评分（倒 U 型曲线）
 *
 * sweepRatio（刺穿深度 / ATR）与信号质量的物理关系：
 *   < 0.3x ATR  → 深度不足：未触发足量止损，动能湮灭不充分 → 40分基础
 *   0.3–0.5x    → 过渡区：线性增长爬坡
 *   0.5–1.5x    → 最优区间：止损湮灭充分 + 价格能收回 → 80–100分
 *   1.5–2.5x    → 衰减区：深度过大，收回难度上升 → 线性下降
 *   > 2.5x ATR  → 危险区：可能已是结构翻转而非 Sweep → 强制降权
 */
export function scoreSweepDepth(sweepRatio: number): number {
  if (sweepRatio < 0.3) {
    return 40; // 深度不足
  }
  if (sweepRatio <= 0.5) {
    // 0.3–0.5：爬坡段（40→80）
    return 40 + ((sweepRatio - 0.3) / 0.2) * 40;
  }
  if (sweepRatio <= 1.5) {
    // 0.5–1.5：最优区间（80→100）
    return 80 + ((sweepRatio - 0.5) / 1.0) * 20;
  }
  if (sweepRatio <= 2.5) {
    // 1.5–2.5：衰减段（100→60）
    return 100 - ((sweepRatio - 1.5) / 1.0) * 40;
  }
  // > 2.5：危险区（强制 ≤ 50，且越深越低）
  return Math.max(20, 60 - (sweepRatio - 2.5) * 20);
}

/**
 * 流动性扫描检测 (Liquidity Sweep)  (PHASE_05 - V3 Physics Refactor)
 *
 * 物理准则：
 *   Sweep 不是价格刺穿，而是“能量湮灭”。
 *   必须满足：(价格刺穿 + 4h收回) && (OI 发生 3-Sigma 级别的坍缩)。
 *
 * 如果没有 OI 坍缩，说明庄家没有在这里触发大规模强平，只是普通的震荡。
 */
export function detectLiquiditySweep(
  candles: Candle[],
  config: StrategyConfig,
  oiPoints: OpenInterestPoint[] = [],
  sweepWindow = 5
): StructuralSetup[] {
  if (candles.length < 10) return [];

  const closePrices = candles.map(c => c.close);
  const oiResult = detectOiCrash(oiPoints, closePrices);
  if (!oiResult.isCrash) {
    // 马斯克指令：没有能量释放，就没有信号。
    return [];
  }

  const directionPenalty = oiResult.mechanismType === "mixed_deleveraging" ? -10 : 0;

  const results: StructuralSetup[] = [];
  // 基准 ATR
  const baselineAtr =
    candles.slice(-50).reduce((sum, c) => sum + (c.high - c.low), 0) /
      Math.min(50, candles.length) || 1;

  const swingCandles = candles.slice(0, -(sweepWindow));
  if (swingCandles.length < 6) return [];

  const swingPoints = detectSwingPoints(swingCandles);
  const recentCandles = candles.slice(-sweepWindow);
  const lowSwings = swingPoints
    .filter((swing) => swing.type === "low")
    .sort((a, b) => b.price - a.price);
  const highSwings = swingPoints
    .filter((swing) => swing.type === "high")
    .sort((a, b) => a.price - b.price);

  for (const sweepCandle of recentCandles) {
    const matchedLow = lowSwings.find((swing) =>
      sweepCandle.low < swing.price && sweepCandle.close > swing.price
    );
    if (matchedLow) {
      const sweepDepth = matchedLow.price - sweepCandle.low;
      const entryLow = sweepCandle.low;
      const entryHigh = matchedLow.price;
      const stopLossHint = entryLow - sweepDepth * 0.3;
      const riskDist = entryHigh - stopLossHint;
      const takeProfitHint = entryHigh + riskDist * config.minimumRiskReward;
      const sweepRatio = sweepDepth / baselineAtr;
      
      // 动能加成：crashIndex 越负，能量越强
      const momentumBonus = Math.abs(oiResult.crashIndex) * 5;
      const mechanismBonus = oiResult.mechanismType === "long_liquidation" ? 5
                           : oiResult.mechanismType === "short_squeeze"    ? -15
                           : 0;
      const depthScore = scoreSweepDepth(sweepRatio);
      const structureScore = clamp(Math.round(depthScore + momentumBonus + mechanismBonus + directionPenalty), 0, 100);

      results.push({
        timeframe: config.liquiditySweepConfirmationTimeframe,
        direction: "long",
        entryLow,
        entryHigh,
        stopLossHint,
        takeProfitHint,
        structureScore,
        structureReason:
          `看涨流动性扫荡(物理确认): 刺破 ${matchedLow.price.toFixed(0)} | ` +
          `${oiResult.reason} | 能量指数: ${oiResult.crashIndex.toFixed(1)}R`,
        invalidationReason: `1h收盘跌破 ${stopLossHint.toFixed(0)}`,
        confluenceFactors: ["liquidity-sweep"],
        confirmationStatus: "pending",
        confirmationTimeframe: "1h",
        reasonCodes: ["LIQUIDITY_SWEEP_CONFIRMED", "STRUCTURE_CONFIRMATION_PENDING"],
      });
    }

    const matchedHigh = highSwings.find((swing) =>
      sweepCandle.high > swing.price && sweepCandle.close < swing.price
    );
    if (matchedHigh) {
      const sweepDepth = sweepCandle.high - matchedHigh.price;
      const entryHigh = sweepCandle.high;
      const entryLow = matchedHigh.price;
      const stopLossHint = entryHigh + sweepDepth * 0.3;
      const riskDist = stopLossHint - entryLow;
      const takeProfitHint = entryLow - riskDist * config.minimumRiskReward;
      const sweepRatio = sweepDepth / baselineAtr;

      const momentumBonus = Math.abs(oiResult.crashIndex) * 5;
      const mechanismBonus = oiResult.mechanismType === "short_squeeze"    ? 5
                           : oiResult.mechanismType === "long_liquidation" ? -15
                           : 0;
      const depthScore = scoreSweepDepth(sweepRatio);
      const structureScore = clamp(Math.round(depthScore + momentumBonus + mechanismBonus + directionPenalty), 0, 100);

      results.push({
        timeframe: config.liquiditySweepConfirmationTimeframe,
        direction: "short",
        entryLow,
        entryHigh,
        stopLossHint,
        takeProfitHint,
        structureScore,
        structureReason:
          `看跌流动性扫荡(物理确认): 刺破 ${matchedHigh.price.toFixed(0)} | ` +
          `${oiResult.reason} | 能量指数: ${oiResult.crashIndex.toFixed(1)}R`,
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

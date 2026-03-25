import type { Candle } from "../../domain/market/candle.js";
import type { OpenInterestPoint } from "../../domain/market/open-interest.js";
import type { StructuralSetup } from "../../domain/signal/structural-setup.js";
import type { StrategyConfig } from "../../app/config.js";
import { clamp } from "../../utils/math.js";
import { detectOiCrash } from "../analysis/detect-oi-crash.js";
import { computeCvdAcceleration } from "../analysis/compute-cvd.js";

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
 * CVD 方向对齐评分（连续函数）
 *
 * 物理含义：
 *   CVD 斜率代表主动力量的方向和强度。
 *   斜率与 Sweep 方向一致 → 加分（主动力量确认）
 *   斜率与 Sweep 方向背离 → 减分（主动力量反对）
 *   幅度越大，评分影响越大（连续响应）
 *
 * @param cvdSlope       CVD 加速度斜率（正=bullish，负=bearish）
 * @param sweepDirection Sweep 方向（"long"=看涨, "short"=看跌）
 * @returns              评分调整值（正=加分，负=减分），范围约 [-25, +10]
 */
export function computeCvdAlignmentScore(
  cvdSlope: number,
  sweepDirection: "long" | "short"
): number {
  // 对齐系数：slope 方向与 sweep方向一致时为正，反之为负
  const alignmentSign = sweepDirection === "long" ? 1 : -1;
  const effectiveSlope = cvdSlope * alignmentSign;
  
  if (effectiveSlope > 0) {
    return Math.min(10, Math.round(effectiveSlope * 100));
  }
  
  const absSlope = Math.abs(effectiveSlope);
  const penalty = Math.min(25, Math.round(absSlope * absSlope * 625));
  return -penalty;
}

/**
 * Sweep 深度非线性评分（倒 U 型曲线 — 自适应版）
 *
 * @param sweepRatio    刺穿深度 / ATR
 * @param optimalUpper  最优区间上界（由 regime 决定，默认 1.5）
 *
 * 注意：optimalUpper 必须 > 0.5，否则最优区间退化。
 * 实际配置最小值为 sweepOptimalUpperHighVol = 1.2，生产环境不会触发除零，
 * 但加入防御检查以保证单元测试极端输入安全。
 */
export function scoreSweepDepth(sweepRatio: number, optimalUpper = 1.5): number {
  const dangerStart = optimalUpper * 1.67;  // 危险区起始

  if (sweepRatio < 0.3) return 40;           // 深度不足
  if (sweepRatio <= 0.5) {                   // 爬坡段（40→80）
    return 40 + ((sweepRatio - 0.3) / 0.2) * 40;
  }
  if (sweepRatio <= optimalUpper) {           // 最优区间（80→100）
    const span = optimalUpper - 0.5;
    if (span <= 0) return 80;                 // 防御性：区间退化时返回基础分
    return 80 + ((sweepRatio - 0.5) / span) * 20;
  }
  if (sweepRatio <= dangerStart) {            // 衰减段（100→60）
    return 100 - ((sweepRatio - optimalUpper) / (dangerStart - optimalUpper)) * 40;
  }
  // 危险区
  return Math.max(20, 60 - (sweepRatio - dangerStart) * 20);
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
  sweepWindow = 5,
  sweepOptimalUpper = 1.5
): StructuralSetup[] {
  if (candles.length < 10) return [];

  const closePrices = candles.map(c => c.close);
  const oiResult = detectOiCrash(oiPoints, closePrices);
  if (!oiResult.isCrash) {
    // 马斯克指令：没有能量释放，就没有信号。
    return [];
  }

  const cvdAcc = computeCvdAcceleration(candles, 12);

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
      
      const cvdBonus = computeCvdAlignmentScore(cvdAcc.cvdSlope, "long");
      
      const depthScore = scoreSweepDepth(sweepRatio, sweepOptimalUpper);
      const structureScore = clamp(Math.round(depthScore + momentumBonus + mechanismBonus + directionPenalty + cvdBonus), 0, 100);
      const cvdReason = `CVD加速(${cvdAcc.direction}, slope=${cvdAcc.cvdSlope.toFixed(3)})`;

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
          `${oiResult.reason} | 能量指数: ${oiResult.crashIndex.toFixed(1)}R | ${cvdReason}`,
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
                           
      const cvdBonus = computeCvdAlignmentScore(cvdAcc.cvdSlope, "short");
                     
      const depthScore = scoreSweepDepth(sweepRatio, sweepOptimalUpper);
      const structureScore = clamp(Math.round(depthScore + momentumBonus + mechanismBonus + directionPenalty + cvdBonus), 0, 100);
      const cvdReason = `CVD加速(${cvdAcc.direction}, slope=${cvdAcc.cvdSlope.toFixed(3)})`;

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
          `${oiResult.reason} | 能量指数: ${oiResult.crashIndex.toFixed(1)}R | ${cvdReason}`,
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

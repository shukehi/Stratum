import type { Candle } from "../../domain/market/candle.js";
import type { RegimeDecision } from "../../domain/regime/regime-decision.js";
import type { ReasonCode } from "../../domain/common/reason-code.js";
import type { StrategyConfig } from "../../app/config.js";
import { clamp } from "../../utils/math.js";

/**
 * 市场状态识别引擎 (PHASE_03)
 *
 * 判断顺序（固定优先级）:
 *   1. event-driven  ≥ eventDrivenOverrideScore  → 直接返回
 *   2. high-volatility ≥ highVolatilityOverrideScore → 直接返回
 *   3. trend vs range 得分差 ≥ minRegimeScoreGap → 取高分者
 *   4. 否则: REGIME_AMBIGUOUS → 默认返回 range，置信度打折
 *
 * 趋势衰竭惩罚:
 *   当近期下半段 ATR / 上半段 ATR ≥ trendExtensionAtrPenaltyThreshold
 *   对 trendScore 施加 0.55x 惩罚因子。
 */
export function detectMarketRegime(
  candles: Candle[],
  config: StrategyConfig
): RegimeDecision {
  const MIN_CANDLES = 14;

  if (candles.length < MIN_CANDLES) {
    return {
      regime: "range",
      confidence: 40,
      reasons: ["数据不足（< 14 根），无法判断市场状态，默认返回 range"],
      reasonCodes: ["REGIME_AMBIGUOUS"],
    };
  }

  const reasons: string[] = [];
  const reasonCodes: ReasonCode[] = [];

  // ── ATR 计算 ────────────────────────────────────────────────
  const recentCandles = candles.slice(-14);
  const baselineCandles = candles.slice(-Math.min(50, candles.length));

  const calcAvgRange = (cs: Candle[]): number =>
    cs.reduce((sum, c) => sum + (c.high - c.low), 0) / cs.length || 1;

  const recentAtr = calcAvgRange(recentCandles);
  const baselineAtr = calcAvgRange(baselineCandles);
  const atrRatio = recentAtr / baselineAtr;

  // ── Event-driven 检测 ────────────────────────────────────────
  // 最近 5 根中出现极端 K 线（实体 > 3x baseline ATR）
  const last5 = candles.slice(-5);
  const extremeCandle = last5.find(c => c.high - c.low > 3 * baselineAtr);
  const eventDrivenScore = extremeCandle
    ? Math.min(95, 60 + ((extremeCandle.high - extremeCandle.low) / baselineAtr - 3) * 10)
    : 15;

  // ── High-volatility 检测 ─────────────────────────────────────
  // 近期 ATR 与基准 ATR 比值 > 1.5 触发
  const highVolatilityScore =
    atrRatio > 1.5
      ? Math.min(90, 50 + (atrRatio - 1.5) * 40)
      : Math.max(10, atrRatio * 20);

  // ── 方向一致性 (Trend / Range 评分) ─────────────────────────
  const closes = recentCandles.map(c => c.close);
  let ups = 0;
  let downs = 0;
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) ups++;
    else if (closes[i] < closes[i - 1]) downs++;
  }
  const total = closes.length - 1;
  const directionalBias = total > 0 ? Math.abs(ups - downs) / total : 0;

  let trendScore = directionalBias * 100;
  const rangeScore = (1 - directionalBias) * 100;

  // ── 趋势末端衰竭惩罚 ─────────────────────────────────────────
  // 将近 14 根分成前半 / 后半，若后半 ATR / 前半 ATR ≥ 阈值，则惩罚 trendScore
  const half = Math.floor(recentCandles.length / 2);
  const earlyHalfAtr = calcAvgRange(recentCandles.slice(0, half));
  const lateHalfAtr = calcAvgRange(recentCandles.slice(half));
  const atrExpansion = lateHalfAtr / earlyHalfAtr;

  let trendExhausted = false;
  if (atrExpansion >= config.trendExtensionAtrPenaltyThreshold) {
    trendScore *= 0.55;
    trendExhausted = true;
    reasons.push(
      `趋势末端衰竭惩罚: ATR 扩展比 ${atrExpansion.toFixed(2)}x ≥ 阈值 ${config.trendExtensionAtrPenaltyThreshold}，trendScore 已打折`
    );
    reasonCodes.push("REGIME_TREND_EXHAUSTED");
  }

  // ── 固定优先级选择 ────────────────────────────────────────────

  // 1. event-driven 优先
  if (eventDrivenScore >= config.eventDrivenOverrideScore) {
    reasons.unshift(
      `事件驱动: 极端 K 线 ${(eventDrivenScore).toFixed(0)} 分 ≥ 阈值 ${config.eventDrivenOverrideScore}`
    );
    reasonCodes.push("REGIME_EVENT_DRIVEN");
    return { regime: "event-driven", confidence: Math.round(eventDrivenScore), reasons, reasonCodes };
  }

  // 2. high-volatility 优先
  if (highVolatilityScore >= config.highVolatilityOverrideScore) {
    reasons.unshift(
      `高波动率: ATR 比率 ${atrRatio.toFixed(2)}x, 得分 ${highVolatilityScore.toFixed(0)} ≥ 阈值 ${config.highVolatilityOverrideScore}`
    );
    reasonCodes.push("REGIME_HIGH_VOLATILITY");
    return { regime: "high-volatility", confidence: Math.round(highVolatilityScore), reasons, reasonCodes };
  }

  // 3. trend vs range
  const winner: "trend" | "range" = trendScore >= rangeScore ? "trend" : "range";
  const winnerScore = Math.max(trendScore, rangeScore);
  const loserScore = Math.min(trendScore, rangeScore);
  const gap = winnerScore - loserScore;

  if (gap < config.minRegimeScoreGap) {
    reasons.push(
      `状态模糊: trend/range 得分差 ${gap.toFixed(1)} < 阈值 ${config.minRegimeScoreGap}，默认返回 range`
    );
    reasonCodes.push("REGIME_AMBIGUOUS");
    return {
      regime: "range",
      confidence: Math.round(winnerScore * 0.8),
      reasons,
      reasonCodes,
    };
  }

  // 4. 明确 winner
  if (winner === "trend") {
    const direction = ups > downs ? "上升" : "下降";
    reasons.push(
      `趋势确认 (${direction}): 方向一致性 ${(directionalBias * 100).toFixed(0)}%` +
      (trendExhausted ? "，已施加衰竭惩罚" : "")
    );
  } else {
    reasons.push(
      `震荡确认: 方向一致性低 ${(directionalBias * 100).toFixed(0)}%, rangeScore ${rangeScore.toFixed(0)}`
    );
  }

  const confidence = clamp(Math.round(winnerScore), 0, 100);

  if (confidence < config.minRegimeConfidence) {
    reasonCodes.push("REGIME_LOW_CONFIDENCE");
    reasons.push(`置信度 ${confidence}% 低于配置阈值 ${config.minRegimeConfidence}%`);
  }

  return { regime: winner, confidence, reasons, reasonCodes };
}

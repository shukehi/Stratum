import type { Candle } from "../../domain/market/candle.js";
import type { FundingRatePoint } from "../../domain/market/funding-rate.js";
import type { OpenInterestPoint } from "../../domain/market/open-interest.js";
import type { RegimeDecision } from "../../domain/regime/regime-decision.js";
import type { MarketDriverType } from "../../domain/regime/market-driver-type.js";
import type { ReasonCode } from "../../domain/common/reason-code.js";
import type { StrategyConfig } from "../../app/config.js";
import { clamp, percentChange } from "../../utils/math.js";

export type RegimeMechanismInputs = {
  fundingRates?: FundingRatePoint[];
  openInterest?: OpenInterestPoint[];
  spotPrice?: number;
};

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
  config: StrategyConfig,
  inputs: RegimeMechanismInputs = {}
): RegimeDecision {
  const MIN_CANDLES = 14;

  if (candles.length < MIN_CANDLES) {
    return {
      regime: "range",
      confidence: 40,
      driverType: "unclear",
      driverConfidence: 35,
      driverReasons: ["数据不足，无法识别市场驱动机制"],
      reasons: ["数据不足（< 14 根），无法判断市场状态，默认返回 range"],
      reasonCodes: ["REGIME_AMBIGUOUS", "REGIME_DRIVER_UNCLEAR"],
    };
  }

  const reasons: string[] = [];
  const reasonCodes: ReasonCode[] = [];
  const mechanism = detectMarketDriver(candles, config, inputs);

  reasons.push(
    `驱动机制: ${mechanism.driverType} (${mechanism.driverConfidence}%) — ${mechanism.reasons[0]}`
  );
  reasonCodes.push(...mechanism.reasonCodes);

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
  let rangeScore = (1 - directionalBias) * 100;

  switch (mechanism.driverType) {
    case "new-longs":
    case "new-shorts":
      trendScore += 15;
      break;
    case "short-covering":
    case "long-liquidation":
      trendScore *= 0.75;
      rangeScore += 10;
      break;
    case "deleveraging-vacuum":
      trendScore *= 0.4;
      rangeScore += 15;
      break;
    case "unclear":
      rangeScore += 10;
      break;
  }

  trendScore = clamp(trendScore, 0, 100);
  rangeScore = clamp(rangeScore, 0, 100);

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
    // NOTE: reasons/reasonCodes pushed after priority overrides to avoid
    // REGIME_TREND_EXHAUSTED leaking into event-driven/high-volatility results
  }

  // ── 固定优先级选择 ────────────────────────────────────────────

  // 1. event-driven 优先（override: 趋势衰竭信息在此情况下无关，不纳入）
  if (eventDrivenScore >= config.eventDrivenOverrideScore) {
    reasons.unshift(
      `事件驱动: 极端 K 线 ${(eventDrivenScore).toFixed(0)} 分 ≥ 阈值 ${config.eventDrivenOverrideScore}`
    );
    reasonCodes.push("REGIME_EVENT_DRIVEN");
    return {
      regime: "event-driven",
      confidence: Math.round(eventDrivenScore),
      driverType: mechanism.driverType,
      driverConfidence: mechanism.driverConfidence,
      driverReasons: mechanism.reasons,
      reasons,
      reasonCodes: [...new Set(reasonCodes)],
    };
  }

  // 2. high-volatility 优先
  if (highVolatilityScore >= config.highVolatilityOverrideScore) {
    reasons.unshift(
      `高波动率: ATR 比率 ${atrRatio.toFixed(2)}x, 得分 ${highVolatilityScore.toFixed(0)} ≥ 阈值 ${config.highVolatilityOverrideScore}`
    );
    reasonCodes.push("REGIME_HIGH_VOLATILITY");
    return {
      regime: "high-volatility",
      confidence: Math.round(highVolatilityScore),
      driverType: mechanism.driverType,
      driverConfidence: mechanism.driverConfidence,
      driverReasons: mechanism.reasons,
      reasons,
      reasonCodes: [...new Set(reasonCodes)],
    };
  }

  // 3. trend vs range
  const winner: "trend" | "range" = trendScore >= rangeScore ? "trend" : "range";
  const winnerScore = Math.max(trendScore, rangeScore);
  const loserScore = Math.min(trendScore, rangeScore);
  const gap = winnerScore - loserScore;

  // 到这里才将衰竭惩罚纳入 reasons/reasonCodes（确保不会出现在 event-driven/high-volatility 结果中）
  if (trendExhausted) {
    reasons.push(
      `趋势末端衰竭惩罚: ATR 扩展比 ${atrExpansion.toFixed(2)}x ≥ 阈值 ${config.trendExtensionAtrPenaltyThreshold}，trendScore 已打折`
    );
    reasonCodes.push("REGIME_TREND_EXHAUSTED");
  }

  if (gap < config.minRegimeScoreGap) {
    reasons.push(
      `状态模糊: trend/range 得分差 ${gap.toFixed(1)} < 阈值 ${config.minRegimeScoreGap}，默认返回 range`
    );
    reasonCodes.push("REGIME_AMBIGUOUS");
    return {
      regime: "range",
      confidence: clamp(Math.round(winnerScore * 0.65 + mechanism.driverConfidence * 0.15), 0, 100),
      driverType: mechanism.driverType,
      driverConfidence: mechanism.driverConfidence,
      driverReasons: mechanism.reasons,
      reasons,
      reasonCodes: [...new Set(reasonCodes)],
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

  let confidence = clamp(Math.round(winnerScore * 0.75 + mechanism.driverConfidence * 0.25), 0, 100);

  if (
    (winner === "trend" && ["new-longs", "new-shorts"].includes(mechanism.driverType)) ||
    (winner === "range" && ["unclear", "deleveraging-vacuum"].includes(mechanism.driverType))
  ) {
    confidence = clamp(confidence + 5, 0, 100);
  }

  if (confidence < config.minRegimeConfidence) {
    reasonCodes.push("REGIME_LOW_CONFIDENCE");
    reasons.push(`置信度 ${confidence}% 低于配置阈值 ${config.minRegimeConfidence}%`);
  }

  return {
    regime: winner,
    confidence,
    driverType: mechanism.driverType,
    driverConfidence: mechanism.driverConfidence,
    driverReasons: mechanism.reasons,
    reasons,
    reasonCodes: [...new Set(reasonCodes)],
  };
}

type DriverAssessment = {
  driverType: MarketDriverType;
  driverConfidence: number;
  reasons: string[];
  reasonCodes: ReasonCode[];
};

function detectMarketDriver(
  candles: Candle[],
  config: StrategyConfig,
  inputs: RegimeMechanismInputs
): DriverAssessment {
  const fundingRates = inputs.fundingRates ?? [];
  const openInterest = inputs.openInterest ?? [];
  const spotPrice = inputs.spotPrice ?? 0;

  const priceWindow = candles.slice(-4);
  const oiWindow = openInterest.slice(-4);
  const fundingWindow = fundingRates.slice(-3);
  const lastClose = candles.at(-1)?.close ?? 0;

  const priceChange =
    priceWindow.length >= 2
      ? percentChange(priceWindow[0].open, priceWindow.at(-1)?.close ?? priceWindow[0].open)
      : 0;
  const oiChange =
    oiWindow.length >= 2
      ? percentChange(oiWindow[0].openInterest, oiWindow.at(-1)?.openInterest ?? oiWindow[0].openInterest)
      : 0;
  const avgFunding =
    fundingWindow.length > 0
      ? fundingWindow.reduce((sum, point) => sum + point.fundingRate, 0) / fundingWindow.length
      : 0;
  const spotPerpBasis = spotPrice > 0 ? (spotPrice - lastClose) / spotPrice : 0;
  const FUNDING_THRESHOLD = 0.0001;

  if (oiWindow.length < 2) {
    return {
      driverType: "unclear",
      driverConfidence: 35,
      reasons: ["OI 数据不足，无法识别市场驱动机制"],
      reasonCodes: ["REGIME_DRIVER_UNCLEAR"],
    };
  }

  if (oiChange <= -config.oiCollapseVacuumThresholdPercent && priceChange < 0) {
    return {
      driverType: "deleveraging-vacuum",
      driverConfidence: 88,
      reasons: [
        `OI 跌幅 ${(oiChange * 100).toFixed(2)}% + 价格下跌 ${(priceChange * 100).toFixed(2)}%，属于去杠杆真空`
      ],
      reasonCodes: ["DELEVERAGING_VACUUM"],
    };
  }

  const reasons: string[] = [];
  const reasonCodes: ReasonCode[] = [];
  let driverType: MarketDriverType = "unclear";
  let confidence = 45;

  if (priceChange > 0 && oiChange > 0) {
    driverType = "new-longs";
    confidence = 65 + Math.min(20, oiChange * 250);
    reasons.push("价格上涨且 OI 上升，说明上涨主要由新多头开仓推动");
    reasonCodes.push("REGIME_DRIVER_NEW_LONGS");
  } else if (priceChange < 0 && oiChange > 0) {
    driverType = "new-shorts";
    confidence = 65 + Math.min(20, oiChange * 250);
    reasons.push("价格下跌且 OI 上升，说明下跌主要由新空头开仓推动");
    reasonCodes.push("REGIME_DRIVER_NEW_SHORTS");
  } else if (priceChange > 0 && oiChange < 0) {
    driverType = "short-covering";
    confidence = 58 + Math.min(18, Math.abs(oiChange) * 220);
    reasons.push("价格上涨但 OI 下降，说明上行主要由空头回补而非新多头推动");
    reasonCodes.push("REGIME_DRIVER_SHORT_COVERING");
  } else if (priceChange < 0 && oiChange < 0) {
    driverType = "long-liquidation";
    confidence = 58 + Math.min(18, Math.abs(oiChange) * 220);
    reasons.push("价格下跌且 OI 下降，说明下行主要由多头平仓/清算推动");
    reasonCodes.push("REGIME_DRIVER_LONG_LIQUIDATION");
  } else {
    reasons.push("价格与 OI 没有形成清晰联动，市场驱动机制不明确");
    reasonCodes.push("REGIME_DRIVER_UNCLEAR");
  }

  if (Math.abs(avgFunding) >= FUNDING_THRESHOLD) {
    if (driverType === "new-longs" && avgFunding > 0) {
      confidence += 8;
      reasons.push(`资金费率为正 (${avgFunding.toFixed(6)})，确认新多头推动`);
    } else if (driverType === "new-shorts" && avgFunding < 0) {
      confidence += 8;
      reasons.push(`资金费率为负 (${avgFunding.toFixed(6)})，确认新空头推动`);
    } else if (driverType === "short-covering" && avgFunding < 0) {
      confidence += 5;
      reasons.push(`资金费率仍为负 (${avgFunding.toFixed(6)})，说明回补主要发生在原有空头拥挤环境`);
    } else if (driverType === "long-liquidation" && avgFunding > 0) {
      confidence += 5;
      reasons.push(`资金费率仍为正 (${avgFunding.toFixed(6)})，说明去杠杆主要发生在原有多头拥挤环境`);
    } else {
      reasons.push(`资金费率 ${avgFunding.toFixed(6)} 未进一步确认当前驱动机制`);
    }
  }

  if (spotPrice > 0 && Math.abs(spotPerpBasis) >= config.basisDivergenceThreshold) {
    if (driverType === "new-longs" && spotPerpBasis < 0) {
      confidence += 6;
      reasons.push(`永续溢价 ${spotPerpBasis.toFixed(4)}，确认期货端多头主动追价`);
    } else if (driverType === "new-shorts" && spotPerpBasis > 0) {
      confidence += 6;
      reasons.push(`现货溢价 ${spotPerpBasis.toFixed(4)}，确认期货端空头主动压价`);
    } else if (driverType === "short-covering" && spotPerpBasis > 0) {
      confidence += 4;
      reasons.push(`现货溢价 ${spotPerpBasis.toFixed(4)}，说明上行并非纯期货追多`);
    } else if (driverType === "long-liquidation" && spotPerpBasis < 0) {
      confidence += 4;
      reasons.push(`永续溢价 ${spotPerpBasis.toFixed(4)}，说明下行更像期货端去杠杆`);
    }
  }

  return {
    driverType,
    driverConfidence: clamp(Math.round(confidence), 0, 95),
    reasons,
    reasonCodes,
  };
}

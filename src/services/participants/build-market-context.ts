import type { RegimeDecision } from "../../domain/regime/regime-decision.js";
import type { ParticipantPressure } from "../../domain/participants/participant-pressure.js";
import type { MarketContext, LiquiditySession } from "../../domain/market/market-context.js";
import type { ReasonCode } from "../../domain/common/reason-code.js";

/**
 * 组合 Regime + Participant + Session → MarketContext (PHASE_04)
 *
 * 此函数仅负责组装，不做任何决策逻辑。
 * 决策（是否可交易、信号等级）由后续 PHASE_05/06 完成。
 */
export function buildMarketContext(
  regimeDecision: RegimeDecision,
  pressure: ParticipantPressure,
  session: LiquiditySession
): MarketContext {
  // 合并 reasonCodes，去重
  const allCodes = [...regimeDecision.reasonCodes, ...pressure.reasonCodes];
  const reasonCodes: ReasonCode[] = [...new Set(allCodes)];

  const summary =
    `Regime: ${regimeDecision.regime} (${regimeDecision.confidence}%) | ` +
    `Driver: ${regimeDecision.driverType ?? "unclear"} (${regimeDecision.driverConfidence ?? 0}%) | ` +
    `Participants: ${pressure.bias} / ${pressure.pressureType} (${pressure.confidence}%) | ` +
    `Session: ${session}`;

  return {
    regime: regimeDecision.regime,
    regimeConfidence: regimeDecision.confidence,
    regimeReasons: regimeDecision.reasons,
    marketDriverType: regimeDecision.driverType,
    marketDriverConfidence: regimeDecision.driverConfidence,
    participantBias: pressure.bias,
    participantPressureType: pressure.pressureType,
    participantConfidence: pressure.confidence,
    participantRationale: pressure.rationale,
    spotPerpBasis: pressure.spotPerpBasis,
    basisDivergence: pressure.basisDivergence,
    liquiditySession: session,
    summary,
    reasonCodes,
  };
}

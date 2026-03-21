import type { StrategyConfig } from "../../app/config.js";
import type { ReasonCode } from "../../domain/common/reason-code.js";
import type { MarketContext } from "../../domain/market/market-context.js";

export type TradableContextDecision = {
  tradable: boolean;
  reason: string;
  reasonCode?: ReasonCode;
};

/**
 * PHASE_31: 在结构层前对市场上下文做硬门控。
 *
 * 这里的职责不是给信号打分，而是回答:
 * “当前环境是否具备继续寻找结构机会的交易前提？”
 */
export function isTradableContext(
  ctx: MarketContext,
  config: StrategyConfig
): TradableContextDecision {
  if (
    ctx.marketDriverType === "deleveraging-vacuum" ||
    ctx.reasonCodes.includes("DELEVERAGING_VACUUM")
  ) {
    return {
      tradable: false,
      reason: "Deleveraging vacuum detected; skip structure scan until forced flow stabilizes.",
      reasonCode: "DELEVERAGING_VACUUM",
    };
  }

  if (
    ctx.regimeConfidence < config.minRegimeConfidence ||
    ctx.reasonCodes.includes("REGIME_LOW_CONFIDENCE")
  ) {
    return {
      tradable: false,
      reason: "Regime confidence is too low to justify structure-level execution.",
      reasonCode: "REGIME_LOW_CONFIDENCE",
    };
  }

  if (ctx.regime === "high-volatility") {
    return {
      tradable: false,
      reason: "High-volatility regime is gated off before structure detection.",
      reasonCode: "REGIME_HIGH_VOLATILITY",
    };
  }

  if (ctx.regime === "event-driven" && !config.allowEventDrivenSignals) {
    return {
      tradable: false,
      reason: "Event-driven regime is disabled by config; skip structure detection.",
      reasonCode: "REGIME_EVENT_DRIVEN",
    };
  }

  if (
    ctx.participantBias === "balanced" &&
    ctx.participantPressureType === "none" &&
    ctx.participantConfidence < config.minParticipantConfidence
  ) {
    return {
      tradable: false,
      reason: "Participant flow is unclear; skip structure scan until directional pressure resolves.",
      reasonCode: "PARTICIPANT_CONFIDENCE_TOO_LOW",
    };
  }

  return {
    tradable: true,
    reason: "Context is tradable; proceed to structure detection.",
  };
}

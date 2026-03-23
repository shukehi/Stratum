import type { StructuralSetup } from "../../domain/signal/structural-setup.js";
import type { MarketContext } from "../../domain/market/market-context.js";
import type { MarketRegime } from "../../domain/regime/market-regime.js";
import type { TradeCandidate } from "../../domain/signal/trade-candidate.js";
import type { ReasonCode } from "../../domain/common/reason-code.js";
import type { StrategyConfig } from "../../app/config.js";
import type { DailyBias } from "../../domain/market/daily-bias.js";
import type { OrderFlowBias } from "../../domain/market/order-flow.js";
import { computeRiskReward } from "../risk/compute-risk-reward.js";

/**
 * 共识引擎入参 (V2 Physics)
 */
export type ConsensusInput = {
  symbol: string;
  setups: StructuralSetup[];
  ctx: MarketContext;
  config: StrategyConfig;
  baselineAtr?: number;
  dailyBias?: DailyBias;
  orderFlowBias?: OrderFlowBias;
};

/**
 * 信号周转期望 (CVS) 计算器 (V2 Physics)
 */
function computeCVS(
  setup: StructuralSetup,
  regimeAligned: boolean,
  participantAligned: boolean,
  rr: number,
  ctx: MarketContext
): number {
  let multiplier = 1.0;
  if (regimeAligned && participantAligned) multiplier = 1.2;
  else if (!regimeAligned && !participantAligned) multiplier = 0.8;

  let baseScore = setup.structureScore * multiplier;
  if (rr >= 3.0) baseScore *= 1.1;
  if (setup.confirmationStatus === "pending") baseScore *= 0.8;
  if (ctx.reasonCodes.includes("SESSION_LOW_LIQUIDITY_DISCOUNT")) baseScore *= 0.9;

  return Math.round(baseScore * 100) / 100;
}

/**
 * 辅助函数：判断是否对齐
 */
function isRegimeAligned(regime: MarketRegime, config: StrategyConfig): boolean {
  return regime === "trend" || regime === "range";
}

function isParticipantAligned(direction: "long" | "short", pressureType: string): boolean {
  if (pressureType === "balanced" || pressureType === "none") return true;
  return direction === "long" ? pressureType === "squeeze-risk" : pressureType === "flush-risk";
}

/**
 * 共识引擎入口 (V2 Physics)
 */
export function evaluateConsensus(input: ConsensusInput): TradeCandidate[] {
  const { candidates } = analyzeConsensus(input);
  return candidates;
}

export function analyzeConsensus(
  input: ConsensusInput
): { candidates: TradeCandidate[]; skipReasonCode?: ReasonCode } {
  const { symbol, setups, ctx, config, baselineAtr } = input;
  const inVacuum = ctx.reasonCodes.includes("DELEVERAGING_VACUUM");
  const regimeAligned = isRegimeAligned(ctx.regime, config);

  const candidates: TradeCandidate[] = [];
  let lastRejectReason: ReasonCode | undefined;

  for (const setup of setups) {
    if (setup.confirmationStatus === "invalidated") {
      lastRejectReason = "STRUCTURE_CONFIRMATION_INVALIDATED";
      continue;
    }
    if (inVacuum) {
      lastRejectReason = "DELEVERAGING_VACUUM";
      continue;
    }
    if (setup.structureScore < config.minStructureScore) {
      lastRejectReason = "STRUCTURE_SCORE_TOO_LOW";
      continue;
    }

    const rr = computeRiskReward(setup);
    if (rr < config.minimumRiskReward) {
      lastRejectReason = "RISK_REWARD_TOO_LOW";
      continue;
    }

    if (baselineAtr && baselineAtr > 0) {
      const dist = setup.direction === "long" ? setup.entryHigh - setup.stopLossHint : setup.stopLossHint - setup.entryLow;
      if (dist > config.maxStopDistanceAtr * baselineAtr) {
        lastRejectReason = "STOP_DISTANCE_TOO_WIDE";
        continue;
      }
    }

    const pAligned = isParticipantAligned(setup.direction, ctx.participantPressureType);
    const cvs = computeCVS(setup, regimeAligned, pAligned, rr, ctx);

    candidates.push({
      symbol,
      direction: setup.direction,
      timeframe: setup.timeframe,
      entryLow: setup.entryLow,
      entryHigh: setup.entryHigh,
      stopLoss: setup.stopLossHint,
      takeProfit: setup.takeProfitHint,
      riskReward: rr,
      regimeAligned,
      participantAligned: pAligned,
      structureReason: setup.structureReason,
      contextReason: ctx.summary,
      capitalVelocityScore: cvs,
      reasonCodes: [...setup.reasonCodes],
    });
  }

  return {
    candidates,
    skipReasonCode: candidates.length === 0 ? (lastRejectReason || "STRUCTURE_NO_SETUP") : undefined
  };
}

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
 * 共识引擎入参  (V3 Physics Refactor)
 */
export type ConsensusInput = {
  symbol: string;
  setups: StructuralSetup[];
  ctx: MarketContext;
  config: StrategyConfig;
  baselineAtr?: number;
  /** 日线趋势偏向 */
  dailyBias?: DailyBias;
  /** CVD 订单流偏向 */
  orderFlowBias?: OrderFlowBias;
};

/**
 * 信号周转期望 (CVS) 计算器  (V3 - Physics Refactor)
 * 
 * 公式：
 *   CVS = StructureScore * AlignmentMultiplier * RR_Bonus * ConfirmationFactor
 */
function computeCVS(
  setup: StructuralSetup,
  regimeAligned: boolean,
  participantAligned: boolean,
  rr: number,
  ctx: MarketContext
): number {
  let multiplier = 1.0;
  // 对齐度加权
  if (regimeAligned && participantAligned) multiplier = 1.2;
  else if (!regimeAligned && !participantAligned) multiplier = 0.8;

  let baseScore = setup.structureScore * multiplier;

  // RR 奖励 (追求高周转率)
  if (rr >= 3.0) baseScore *= 1.1;

  // 状态惩罚 (不确定性熵)
  if (setup.confirmationStatus === "pending") baseScore *= 0.8;
  if (ctx.reasonCodes.includes("SESSION_LOW_LIQUIDITY_DISCOUNT")) baseScore *= 0.9;

  return Math.round(baseScore * 100) / 100;
}

/**
 * 共识引擎  (V3)
 *
 * 职责:
 *   综合 MarketContext + StructuralSetup 列表，计算 CVS 并生成 TradeCandidate[]。
 *   不再拦截持仓限额，拦截逻辑下移至执行置换层。
 */
export function evaluateConsensus(input: ConsensusInput): TradeCandidate[] {
  return analyzeConsensus(input).candidates;
}

export function analyzeConsensus(
  input: ConsensusInput
): { candidates: TradeCandidate[]; skipReasonCode?: ReasonCode } {
  const { symbol, setups, ctx, config } = input;
  const baselineAtr = input.baselineAtr;

  const inVacuum = ctx.reasonCodes.includes("DELEVERAGING_VACUUM");
  const regimeAligned = isRegimeAligned(ctx.regime, config);

  const candidates: TradeCandidate[] = [];
  const rejectedReasons: ReasonCode[] = [];

  for (const setup of setups) {
    // ── 1. 物理硬过滤 (不符合物理规律的信号直接丢弃) ───────────────────────────
    if (setup.confirmationStatus === "invalidated") {
      rejectedReasons.push("STRUCTURE_CONFIRMATION_INVALIDATED");
      continue;
    }
    if (inVacuum) {
      rejectedReasons.push("DELEVERAGING_VACUUM");
      continue;
    }
    if (setup.structureScore < config.minStructureScore) {
      rejectedReasons.push("STRUCTURE_SCORE_TOO_LOW");
      continue;
    }

    const rr = computeRiskReward(setup);
    if (rr < config.minimumRiskReward) {
      rejectedReasons.push("RISK_REWARD_TOO_LOW");
      continue;
    }

    if (baselineAtr !== undefined && baselineAtr > 0) {
      const stopDistance =
        setup.direction === "long"
          ? setup.entryHigh - setup.stopLossHint
          : setup.stopLossHint - setup.entryLow;
      if (stopDistance > config.maxStopDistanceAtr * baselineAtr) {
        rejectedReasons.push("STOP_DISTANCE_TOO_WIDE");
        continue;
      }
    }

    // ── 2. 计算物理期望 (CVS) ────────────────────────────────────────────────
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

  if (candidates.length > 0) {
    return { candidates };
  }

  return {
    candidates: [],
    skipReasonCode: rejectedReasons[0] ?? "STRUCTURE_NO_SETUP",
  };
}

// ── 内部辅助 ──────────────────────────────────────────────────────────────────

function isRegimeAligned(regime: MarketRegime, config: StrategyConfig): boolean {
  if (regime === "trend" || regime === "range") return true;
  if (regime === "event-driven") return config.allowEventDrivenSignals;
  return false; // high-volatility 等状态不建议入场
}

function isParticipantAligned(
  direction: "long" | "short",
  pressureType: string
): boolean {
  if (pressureType === "balanced") return true;
  if (direction === "long") {
    return pressureType === "squeeze-risk";
  } else {
    return pressureType === "flush-risk";
  }
}

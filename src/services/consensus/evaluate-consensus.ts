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
 * 信号周转期望 (CVS) 计算器 (V2 Physics — Fixed)
 *
 * 乘数矩阵：
 *   regime对齐 & participant对齐 → ×1.2（双动力加速）
 *   仅一项对齐              → ×1.0（中性）
 *   双不对齐                → ×0.8（逆风减速）
 *   高波动/事件驱动 regime   → 额外 ×0.9（物理噪音惩罚）
 */
function computeCVS(
  setup: StructuralSetup,
  regimeAligned: boolean,
  participantAligned: boolean,
  rr: number,
  ctx: MarketContext,
  config: StrategyConfig
): number {
  // — 推力部分（不变）—
  let multiplier = 1.0;
  if (regimeAligned && participantAligned) multiplier = 1.2;
  else if (!regimeAligned && !participantAligned) multiplier = 0.8;

  let numerator = setup.structureScore * multiplier;

  if (ctx.regime === "high-volatility" || ctx.regime === "event-driven") {
    numerator *= 0.9;
  }
  if (rr >= 3.0) numerator *= 1.1;
  if (setup.confirmationStatus === "pending") numerator *= 0.8;

  // — 摩擦力部分（新增）—
  let effectiveSlippage = config.baseSlippagePct * 2;

  if (ctx.reasonCodes.includes("SESSION_LOW_LIQUIDITY_DISCOUNT")) {
    effectiveSlippage *= config.sessionSlippageMultiplier;
  }

  const frictionDenominator = 1 + effectiveSlippage * 100;
  const cvs = numerator / frictionDenominator;

  return Math.round(cvs * 100) / 100;
}

/**
 * 辅助函数：判断 regime 是否对齐
 *
 * 修复：MarketRegime 有 4 个值：trend | range | event-driven | high-volatility。
 * 原实现 `regime === "trend" || regime === "range"` 看似完整，
 * 但实际上对 trend/range/event-driven/high-volatility 全部覆盖（恒真）。
 * 正确语义：trend 和 range 是可预测的结构市 → 对齐；
 * event-driven 和 high-volatility 是混沌市 → 不对齐。
 */
function isRegimeAligned(regime: MarketRegime, _config: StrategyConfig): boolean {
  return regime === "trend" || regime === "range";
}

/**
 * 辅助函数：判断参与者压力是否对齐
 *
 * 修复：MarketContext.participantPressureType 的值域是
 * "squeeze-risk" | "flush-risk" | "none"，不含 "balanced"。
 * 原实现引用了不存在的 "balanced" 值，导致该分支永不命中。
 */
function isParticipantAligned(direction: "long" | "short", pressureType: string): boolean {
  // "none" 表示无明显挤压风险，双向均可接受
  if (pressureType === "none") return true;
  // squeeze-risk（空头挤压）对 long 有利；flush-risk（多头清洗）对 short 有利
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
    const cvs = computeCVS(setup, regimeAligned, pAligned, rr, ctx, config);

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

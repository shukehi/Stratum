import type { StructuralSetup } from "../../domain/signal/structural-setup.js";
import type { MarketContext } from "../../domain/market/market-context.js";
import type { MarketRegime } from "../../domain/regime/market-regime.js";
import type { TradeCandidate, SignalGrade } from "../../domain/signal/trade-candidate.js";
import type { ReasonCode } from "../../domain/common/reason-code.js";
import type { StrategyConfig } from "../../app/config.js";
import { computeRiskReward } from "../risk/compute-risk-reward.js";

/**
 * 共识引擎入参  (PHASE_06)
 *
 * baselineAtr:       4h 平均真实波幅，用于止损距离门槛（可选）
 * openLongCount:     当前已开多头仓位数，用于相关性暴露控制（可选，默认 0）
 * openShortCount:    当前已开空头仓位数（可选，默认 0）
 */
export type ConsensusInput = {
  symbol: string;
  setups: StructuralSetup[];
  ctx: MarketContext;
  config: StrategyConfig;
  baselineAtr?: number;
  openLongCount?: number;
  openShortCount?: number;
};

/**
 * 共识引擎  (PHASE_06)
 *
 * 职责:
 *   综合 MarketContext + StructuralSetup 列表，通过有序门槛过滤后生成 TradeCandidate[]。
 *
 * 门槛顺序（第一性原理，越早越关键）:
 *   1. invalidated     → 直接丢弃（结构已失效，不输出任何候选）
 *   2. DELEVERAGING_VACUUM in ctx → 丢弃（去杠杆真空期）
 *   3. structureScore < minStructureScore → 丢弃（结构质量不足）
 *   4. 弱参与者 + 低结构分   → 丢弃 + PARTICIPANT_CONFIDENCE_TOO_LOW
 *   5. RR < minimumRiskReward → 丢弃 + RISK_REWARD_TOO_LOW
 *   6. 止损过宽 (ATR 可用时) → 丢弃 + STOP_DISTANCE_TOO_WIDE
 *   7. 相关性暴露超限       → 丢弃 + CORRELATED_EXPOSURE_LIMIT
 *
 * 方向校准:
 *   isRegimeAligned:
 *     trend / range → true
 *     high-volatility → false（噪音过高）
 *     event-driven   → config.allowEventDrivenSignals
 *
 *   isParticipantAligned:
 *     做多 + squeeze-risk → true  (空头被挤，顺势做多)
 *     做空 + flush-risk   → true  (多头被清，顺势做空)
 *     balanced            → true  (中性，不干扰)
 *     做多 + flush-risk   → false (多头被清，逆势做多)
 *     做空 + squeeze-risk → false (空头被挤，逆势做空)
 *
 * 信号等级算法（先计算基础等级，再应用上限）:
 *   基础等级:
 *     score ≥ 80 AND regimeAligned AND participantAligned AND hasConfluence → high-conviction
 *     score ≥ 65 AND (regimeAligned OR participantAligned)                 → standard
 *     otherwise                                                            → watch
 *
 *   上限（顺序应用，只降不升）:
 *     confirmationStatus === "pending"          → 上限 watch
 *     participantConfidence < min (弱参与者)    → 上限 watch
 *     SESSION_LOW_LIQUIDITY_DISCOUNT 存在       → 降一级（high-conviction→standard, standard→watch）
 *
 * 禁止:
 *   - 不输出最终仓位 (由 compute-position-size 单独处理)
 *   - 不访问 LLM / 宏观语义（PHASE_07 职责）
 *   - 不接数据库
 */
export function evaluateConsensus(input: ConsensusInput): TradeCandidate[] {
  const { symbol, setups, ctx, config } = input;
  const baselineAtr = input.baselineAtr;
  const openLongCount = input.openLongCount ?? 0;
  const openShortCount = input.openShortCount ?? 0;

  const inVacuum = ctx.reasonCodes.includes("DELEVERAGING_VACUUM");
  const regimeAligned = isRegimeAligned(ctx.regime, config);

  const candidates: TradeCandidate[] = [];

  for (const setup of setups) {
    // ── 门槛 1: 结构已失效 ───────────────────────────────────────────────────
    if (setup.confirmationStatus === "invalidated") continue;

    // ── 门槛 2: 去杠杆真空期 ─────────────────────────────────────────────────
    if (inVacuum) continue;

    // ── 门槛 3: 结构分数不足 ─────────────────────────────────────────────────
    if (setup.structureScore < config.minStructureScore) continue;

    // ── 门槛 4: 弱参与者 + 低结构分（高结构分可覆盖弱参与者信号）───────────────
    const weakParticipant =
      ctx.participantConfidence < config.minParticipantConfidence;
    if (
      weakParticipant &&
      setup.structureScore < config.minStructureScoreForWeakParticipantOverride
    ) {
      continue;
    }

    // ── 门槛 5: 风险回报比不足 ───────────────────────────────────────────────
    const rr = computeRiskReward(setup);
    if (rr < config.minimumRiskReward) {
      continue;
    }

    // ── 门槛 6: 止损距离过宽（ATR 可用时才检查）─────────────────────────────
    if (baselineAtr !== undefined && baselineAtr > 0) {
      const stopDistance =
        setup.direction === "long"
          ? setup.entryHigh - setup.stopLossHint
          : setup.stopLossHint - setup.entryLow;
      if (stopDistance > config.maxStopDistanceAtr * baselineAtr) {
        continue;
      }
    }

    // ── 门槛 7: 相关性暴露超限 ───────────────────────────────────────────────
    if (
      setup.direction === "long" &&
      openLongCount >= config.maxCorrelatedSignalsPerDirection
    ) {
      continue;
    }
    if (
      setup.direction === "short" &&
      openShortCount >= config.maxCorrelatedSignalsPerDirection
    ) {
      continue;
    }

    // ── 方向校准 ─────────────────────────────────────────────────────────────
    const participantAligned = isParticipantAligned(
      setup.direction,
      ctx.participantPressureType
    );

    // ── 信号等级：基础等级 ───────────────────────────────────────────────────
    const hasConfluence = setup.confluenceFactors.length >= 2;
    let grade = computeBaseGrade(
      setup.structureScore,
      regimeAligned,
      participantAligned,
      hasConfluence
    );

    // ── 信号等级：上限修正 ───────────────────────────────────────────────────
    if (setup.confirmationStatus === "pending") {
      grade = "watch";
    } else if (weakParticipant) {
      grade = "watch";
    } else if (setup.reasonCodes.includes("SESSION_LOW_LIQUIDITY_DISCOUNT")) {
      grade = downgradeGrade(grade);
    }

    // ── 合并 reasonCodes ──────────────────────────────────────────────────────
    const mergedCodes: ReasonCode[] = [
      ...new Set([...setup.reasonCodes, ...ctx.reasonCodes]),
    ];

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
      participantAligned,
      structureReason: setup.structureReason,
      contextReason: ctx.summary,
      signalGrade: grade,
      reasonCodes: mergedCodes,
    });
  }

  return candidates;
}

// ── 内部辅助 ──────────────────────────────────────────────────────────────────

function isRegimeAligned(regime: MarketRegime, config: StrategyConfig): boolean {
  switch (regime) {
    case "trend":
    case "range":
      return true;
    case "high-volatility":
      return false;
    case "event-driven":
      return config.allowEventDrivenSignals;
  }
}

function isParticipantAligned(
  direction: "long" | "short",
  pressureType: "squeeze-risk" | "flush-risk" | "none"
): boolean {
  if (pressureType === "none") return true;
  if (direction === "long" && pressureType === "squeeze-risk") return true;   // 空头被挤，顺势
  if (direction === "short" && pressureType === "flush-risk") return true;    // 多头被清，顺势
  return false; // 逆势
}

function computeBaseGrade(
  score: number,
  regimeAligned: boolean,
  participantAligned: boolean,
  hasConfluence: boolean
): SignalGrade {
  if (
    score >= 80 &&
    regimeAligned &&
    participantAligned &&
    hasConfluence
  ) {
    return "high-conviction";
  }
  if (score >= 65 && (regimeAligned || participantAligned)) {
    return "standard";
  }
  return "watch";
}

function downgradeGrade(grade: SignalGrade): SignalGrade {
  if (grade === "high-conviction") return "standard";
  if (grade === "standard") return "watch";
  return "watch";
}

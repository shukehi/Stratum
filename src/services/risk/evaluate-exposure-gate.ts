import type { StrategyConfig } from "../../app/config.js";
import type { ReasonCode } from "../../domain/common/reason-code.js";
import type { TradeCandidate } from "../../domain/signal/trade-candidate.js";
import type { OpenPosition } from "../../domain/position/open-position.js";
import type { MarketRegime } from "../../domain/regime/market-regime.js";
import { applySignalDecay } from "../consensus/evaluate-consensus.js";

/**
 * 资本置换协议 (Capital Swapping Protocol - CSP)  (V3 - Physics First)
 *
 * 职责：
 *   不再简单地拦截信号，而是对比“新信号”与“现持仓”的 CVS。
 *   如果新信号具备显著更高的周转期望，则触发“平旧开新”。
 */

export type SwappingDecision = 
  | { action: "allow_direct" } // 风险未超限，直接开仓
  | { action: "allow_swap"; targetPositionId: string; reason: string } // 风险超限，但新信号更强，平掉旧的
  | { action: "block"; reasonCode: ReasonCode; reason: string }; // 风险超限且新信号不够强，拦截

export type ExposureGateInput = {
  candidate: TradeCandidate;
  openPositions: OpenPosition[];
  portfolioOpenRiskPercent: number;
  config: StrategyConfig;
  currentRegime?: MarketRegime;
  regimeConfidence?: number;
};

/**
 * 执行资本置换判定
 */
export function evaluateSwappingGate(
  input: ExposureGateInput
): SwappingDecision {
  const { candidate, openPositions, portfolioOpenRiskPercent, config, currentRegime, regimeConfidence } = input;

  // ── TASK-P3-A: 组合方向倾斜度保护 ──────────────────────────────────────────
  const longCount = openPositions.filter(p => p.direction === "long").length;
  const shortCount = openPositions.filter(p => p.direction === "short").length;
  const directionImbalance = Math.abs(longCount - shortCount);
  const isExtremeSingleSided =
    directionImbalance >= config.maxDirectionImbalance &&
    candidate.direction === (longCount > shortCount ? "long" : "short");

  if (isExtremeSingleSided) {
    return {
      action: "block",
      reasonCode: "PORTFOLIO_RISK_LIMIT",
      reason: `组合倾斜度超限 (多空数量差 ${directionImbalance} >= 阈值 ${config.maxDirectionImbalance})，拦截加剧偏载的同向信号`
    };
  }

  // 1. 检查总体账户风险是否还有余量
  const hasGlobalBuffer = (portfolioOpenRiskPercent + config.riskPerTrade) <= config.maxPortfolioOpenRiskPercent;
  
  // 2. 检查同向持仓是否未达上限
  const sameDirCount = openPositions.filter(p => p.direction === candidate.direction).length;
  const hasSameDirBuffer = sameDirCount < config.maxCorrelatedSignalsPerDirection;

  if (hasGlobalBuffer && hasSameDirBuffer) {
    return { action: "allow_direct" };
  }

  // ── 3. 资本置换逻辑 (Capital Swapping) ───────────────────────────────────
  
  // 寻找场内最弱的头寸（CVS 最低且显著低于新信号）
  const weakestPosition = openPositions
    .filter(p => p.direction === candidate.direction) // 优先置换同向
    .sort((a, b) => a.capitalVelocityScore - b.capitalVelocityScore)[0];

  if (weakestPosition) {
    // 门槛：新信号 CVS 必须比旧信号高出要求比例
    const baseThreshold = {
      "trend":          config.cspSwapThresholdTrend,
      "range":          config.cspSwapThresholdRange,
      "high-volatility": config.cspSwapThresholdHighVolatility,
      "event-driven":   config.cspSwapThresholdEventDriven,
    }[currentRegime ?? "range"] ?? config.cspSwapThresholdRange;
  
    // 置信度低时进一步收紧（每低 10% 置信度，门槛额外 +0.05）
    const confidenceAdj = (regimeConfidence ?? 70) < 70 ? (70 - (regimeConfidence ?? 70)) / 10 * 0.05 : 0;
    const SWAP_THRESHOLD_RATIO = baseThreshold + confidenceAdj;

    const positionAge = Date.now() - weakestPosition.openedAt;
    const decayedPositionCvs = applySignalDecay(weakestPosition.capitalVelocityScore, positionAge);

    if (candidate.capitalVelocityScore > decayedPositionCvs * SWAP_THRESHOLD_RATIO) {
      return { 
        action: "allow_swap", 
        targetPositionId: weakestPosition.id,
        reason: `资本置换：新信号 CVS(${candidate.capitalVelocityScore}) 显著优于旧仓位衰减后 CVS(${decayedPositionCvs}) [原 CVS: ${weakestPosition.capitalVelocityScore}]`
      };
    }
  }

  // 4. 彻底拦截
  return { 
    action: "block", 
    reasonCode: !hasGlobalBuffer ? "PORTFOLIO_RISK_LIMIT" : "CORRELATED_EXPOSURE_LIMIT",
    reason: `风险超限且新信号动能不足以触发置换 (CVS: ${candidate.capitalVelocityScore})`
  };
}

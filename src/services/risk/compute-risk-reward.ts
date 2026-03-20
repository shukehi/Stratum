import type { StructuralSetup } from "../../domain/signal/structural-setup.js";

/**
 * 风险回报比计算  (PHASE_06)
 *
 * 最差入场价原则:
 *   做多 → 以 entryHigh（区间上沿）作为入场价，即最差买入价
 *   做空 → 以 entryLow（区间下沿）作为入场价，即最差卖出价
 *
 * 公式:
 *   做多: RR = (takeProfitHint - entryHigh) / (entryHigh - stopLossHint)
 *   做空: RR = (entryLow  - takeProfitHint) / (stopLossHint - entryLow)
 *
 * 边界保护:
 *   风险区间 ≤ 0（止损在入场价同侧或重合）→ 返回 0
 *   回报 < 0（目标在亏损方向）→ 可返回负值，由调用方通过 minimumRiskReward 门槛过滤
 */
export function computeRiskReward(setup: StructuralSetup): number {
  if (setup.direction === "long") {
    const risk = setup.entryHigh - setup.stopLossHint;
    if (risk <= 0) return 0;
    const reward = setup.takeProfitHint - setup.entryHigh;
    return reward / risk;
  } else {
    const risk = setup.stopLossHint - setup.entryLow;
    if (risk <= 0) return 0;
    const reward = setup.entryLow - setup.takeProfitHint;
    return reward / risk;
  }
}

import type { StrategyConfig } from "../../app/config.js";
import type { ReasonCode } from "../../domain/common/reason-code.js";

/**
 * 暴露度闸门（组合级风险约束）。
 *
 * 职责：
 *   在候选信号进入最终下单阶段前，检查同向拥挤度与组合总风险，
 *   避免系统在相同方向连续加仓，或让总开放风险超出预设上限。
 */
export type ExposureGateInput = {
  /** 当前同方向已持有仓位数量。 */
  sameDirectionExposureCount: number;
  /** 当前同方向所有已开仓位累计风险占账户权益的比例。 */
  sameDirectionOpenRiskPercent: number;
  /** 当前整个组合所有已开仓位累计风险占账户权益的比例。 */
  portfolioOpenRiskPercent: number;
  /** 风控配置。 */
  config: StrategyConfig;
};

/**
 * 按“数量上限 → 同向风险上限 → 组合风险上限”的顺序检查是否允许新增仓位。
 */
export function evaluateExposureGate(
  input: ExposureGateInput
): { allowed: true } | { allowed: false; reasonCode: ReasonCode } {
  const {
    sameDirectionExposureCount,
    sameDirectionOpenRiskPercent,
    portfolioOpenRiskPercent,
    config,
  } = input;

  // 先限制同方向持仓个数，阻止明显拥挤的同向暴露。
  if (
    sameDirectionExposureCount >= config.maxCorrelatedSignalsPerDirection
  ) {
    return { allowed: false, reasonCode: "CORRELATED_EXPOSURE_LIMIT" };
  }

  // 再检查新增一笔后，同方向累计风险是否越过上限。
  if (
    sameDirectionOpenRiskPercent + config.riskPerTrade >
    config.maxSameDirectionOpenRiskPercent
  ) {
    return { allowed: false, reasonCode: "SAME_DIRECTION_RISK_LIMIT" };
  }

  // 最后检查整个平台组合风险，避免多方向合计后过度暴露。
  if (
    portfolioOpenRiskPercent + config.riskPerTrade >
    config.maxPortfolioOpenRiskPercent
  ) {
    return { allowed: false, reasonCode: "PORTFOLIO_RISK_LIMIT" };
  }

  return { allowed: true };
}

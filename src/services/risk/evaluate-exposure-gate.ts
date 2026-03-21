import type { StrategyConfig } from "../../app/config.js";
import type { ReasonCode } from "../../domain/common/reason-code.js";

export type ExposureGateInput = {
  sameDirectionExposureCount: number;
  sameDirectionOpenRiskPercent: number;
  portfolioOpenRiskPercent: number;
  config: StrategyConfig;
};

export function evaluateExposureGate(
  input: ExposureGateInput
): { allowed: true } | { allowed: false; reasonCode: ReasonCode } {
  const {
    sameDirectionExposureCount,
    sameDirectionOpenRiskPercent,
    portfolioOpenRiskPercent,
    config,
  } = input;

  if (
    sameDirectionExposureCount >= config.maxCorrelatedSignalsPerDirection
  ) {
    return { allowed: false, reasonCode: "CORRELATED_EXPOSURE_LIMIT" };
  }

  if (
    sameDirectionOpenRiskPercent + config.riskPerTrade >
    config.maxSameDirectionOpenRiskPercent
  ) {
    return { allowed: false, reasonCode: "SAME_DIRECTION_RISK_LIMIT" };
  }

  if (
    portfolioOpenRiskPercent + config.riskPerTrade >
    config.maxPortfolioOpenRiskPercent
  ) {
    return { allowed: false, reasonCode: "PORTFOLIO_RISK_LIMIT" };
  }

  return { allowed: true };
}

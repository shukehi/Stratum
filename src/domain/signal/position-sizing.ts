export type PositionSizingReason =
  | "account_size_missing"
  | "invalid_stop_distance";

export type PositionSizingSummary = {
  status: "available" | "unavailable";
  reason?: PositionSizingReason;
  recommendedPositionSize?: number;
  recommendedBaseSize?: number;
  riskAmount?: number;
  accountRiskPercent: number;
  sameDirectionExposureCount: number;
  sameDirectionExposureRiskPercent: number;
  projectedSameDirectionRiskPercent: number;
  portfolioOpenRiskPercent: number;
  projectedPortfolioRiskPercent: number;
};

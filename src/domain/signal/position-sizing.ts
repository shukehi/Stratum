/**
 * 仓位计算不可用时的原因。
 */
export type PositionSizingReason =
  | "account_size_missing"
  | "invalid_stop_distance";

/**
 * 仓位建议摘要。
 *
 * 该结构同时承载“是否可计算仓位”“建议仓位大小”以及
 * “新增后组合风险会升到哪里”三类信息，便于 CLI 或告警层直接展示。
 */
export type PositionSizingSummary = {
  /** 是否成功得出可执行的仓位建议。 */
  status: "available" | "unavailable";
  /** 无法计算时的原因。 */
  reason?: PositionSizingReason;
  /** 以报价货币计的建议名义仓位。 */
  recommendedPositionSize?: number;
  /** 以基础资产数量计的建议仓位。 */
  recommendedBaseSize?: number;
  /** 本次交易按固定风险模型应承担的风险金额。 */
  riskAmount?: number;
  /** 单笔交易风险占账户权益的比例。 */
  accountRiskPercent: number;
  /** 当前同方向已有仓位数量。 */
  sameDirectionExposureCount: number;
  /** 当前同方向累计开放风险比例。 */
  sameDirectionExposureRiskPercent: number;
  /** 若执行本次交易，同方向累计风险将达到的比例。 */
  projectedSameDirectionRiskPercent: number;
  /** 当前组合总开放风险比例。 */
  portfolioOpenRiskPercent: number;
  /** 若执行本次交易，组合总开放风险将达到的比例。 */
  projectedPortfolioRiskPercent: number;
};

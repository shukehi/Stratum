import type { StrategyConfig } from "../../app/config.js";
import type { TradeCandidate } from "../../domain/signal/trade-candidate.js";
import type { PositionSizingSummary } from "../../domain/signal/position-sizing.js";

/**
 * 仓位大小计算  (PHASE_06)
 *
 * 固定风险比例模型（Fixed Fractional）:
 *   riskAmount       = accountSize × riskPerTrade
 *   positionSize_base = riskAmount / stopDistance          (基础资产单位)
 *   positionSize_quote = positionSize_base × entryPrice   (报价货币, e.g. USDT)
 *
 * 简化公式:
 *   positionSize_quote = riskAmount × entryPrice / stopDistance
 *                      = accountSize × riskPerTrade × entryPrice / |entryPrice - stopPrice|
 *
 * 示例:
 *   accountSize=$100,000 / riskPerTrade=1% / entry=$60,000 / stop=$58,800
 *   stopDistance=$1,200 → positionSize_quote = $1,000×$60,000/$1,200 = $50,000
 *
 * 边界保护:
 *   entryPrice ≤ 0 或 stopDistance ≤ 0 → 返回 0
 */
export function computePositionSize(
  accountSize: number,
  entryPrice: number,
  stopPrice: number,
  config: StrategyConfig
): number {
  if (entryPrice <= 0) return 0;
  const stopDistance = Math.abs(entryPrice - stopPrice);
  if (stopDistance <= 0) return 0;
  const riskAmount = accountSize * config.riskPerTrade;
  return (riskAmount * entryPrice) / stopDistance;
}

export type BuildPositionSizingInput = {
  candidate: TradeCandidate;
  config: StrategyConfig;
  sameDirectionExposureCount: number;
  sameDirectionOpenRiskPercent: number;
  portfolioOpenRiskPercent: number;
};

export function buildPositionSizingSummary(
  input: BuildPositionSizingInput
): PositionSizingSummary {
  const {
    candidate,
    config,
    sameDirectionExposureCount,
    sameDirectionOpenRiskPercent,
    portfolioOpenRiskPercent,
  } = input;

  const entryMid = (candidate.entryLow + candidate.entryHigh) / 2;
  const accountRiskPercent = config.riskPerTrade * 100; // 展示用百分比，e.g. 0.01 → 1
  const projectedSameDirectionRiskPercent =
    sameDirectionOpenRiskPercent + accountRiskPercent;
  const projectedPortfolioRiskPercent =
    portfolioOpenRiskPercent + accountRiskPercent;

  const riskAmount =
    config.accountSizeUsd > 0
      ? config.accountSizeUsd * config.riskPerTrade // 使用原始小数计算金额
      : undefined;
  const recommendedPositionSize = computePositionSize(
    config.accountSizeUsd,
    entryMid,
    candidate.stopLoss,
    config
  );
  const recommendedBaseSize =
    recommendedPositionSize > 0 && entryMid > 0
      ? recommendedPositionSize / entryMid
      : undefined;

  const stopDistance = Math.abs(entryMid - candidate.stopLoss);
  const unavailableReason =
    stopDistance <= 0 || entryMid <= 0
      ? "invalid_stop_distance"
      : config.accountSizeUsd <= 0
        ? "account_size_missing"
        : undefined;

  return {
    status: unavailableReason ? "unavailable" : "available",
    reason: unavailableReason,
    recommendedPositionSize:
      unavailableReason === undefined ? recommendedPositionSize : undefined,
    recommendedBaseSize:
      unavailableReason === undefined ? recommendedBaseSize : undefined,
    riskAmount,
    accountRiskPercent,
    sameDirectionExposureCount,
    sameDirectionExposureRiskPercent: sameDirectionOpenRiskPercent,
    projectedSameDirectionRiskPercent,
    portfolioOpenRiskPercent,
    projectedPortfolioRiskPercent,
  };
}

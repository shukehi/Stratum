import type { StrategyConfig } from "../../app/config.js";

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

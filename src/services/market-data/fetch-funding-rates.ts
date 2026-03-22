import type { ExchangeClient } from "../../clients/exchange/ccxt-client.js";
import type { FundingRatePoint } from "../../domain/market/funding-rate.js";
import { logger } from "../../app/logger.js";

/**
 * 资金费率拉取适配层。
 *
 * 资金费率用于衡量永续合约多空拥挤度，是市场状态与参与者压力的重要输入。
 */
export async function fetchFundingRates(
  client: ExchangeClient,
  symbol: string,
  limit: number
): Promise<FundingRatePoint[]> {
  // 统一记录窗口大小，便于追踪上游交易所返回的数据完整性。
  logger.debug({ symbol, limit }, "Fetching funding rates");
  return client.fetchFundingRates(symbol, limit);
}

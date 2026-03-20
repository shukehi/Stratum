import type { ExchangeClient } from "../../clients/exchange/ccxt-client.js";
import type { FundingRatePoint } from "../../domain/market/funding-rate.js";
import { logger } from "../../app/logger.js";

export async function fetchFundingRates(
  client: ExchangeClient,
  symbol: string,
  limit: number
): Promise<FundingRatePoint[]> {
  logger.debug({ symbol, limit }, "Fetching funding rates");
  return client.fetchFundingRates(symbol, limit);
}

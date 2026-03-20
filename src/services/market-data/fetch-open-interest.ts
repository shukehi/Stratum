import type { ExchangeClient } from "../../clients/exchange/ccxt-client.js";
import type { OpenInterestPoint } from "../../domain/market/open-interest.js";
import { logger } from "../../app/logger.js";

export async function fetchOpenInterest(
  client: ExchangeClient,
  symbol: string,
  limit: number
): Promise<OpenInterestPoint[]> {
  logger.debug({ symbol, limit }, "Fetching open interest");
  return client.fetchOpenInterest(symbol, limit);
}

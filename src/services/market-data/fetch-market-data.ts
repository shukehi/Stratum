import type { ExchangeClient } from "../../clients/exchange/ccxt-client.js";
import type { Candle } from "../../domain/market/candle.js";
import { logger } from "../../app/logger.js";

export async function fetchMarketData(
  client: ExchangeClient,
  symbol: string,
  timeframe: "4h" | "1h",
  limit: number
): Promise<Candle[]> {
  logger.debug({ symbol, timeframe, limit }, "Fetching market data");
  return client.fetchOHLCV(symbol, timeframe, limit);
}

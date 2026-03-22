import type { ExchangeClient } from "../../clients/exchange/ccxt-client.js";
import type { Candle } from "../../domain/market/candle.js";
import { logger } from "../../app/logger.js";

/**
 * 市场 K 线拉取适配层。
 *
 * 这里只负责记录日志并把请求委托给交易所客户端，
 * 保持调用方不直接依赖具体数据源实现。
 */
export async function fetchMarketData(
  client: ExchangeClient,
  symbol: string,
  timeframe: "4h" | "1h" | "1d",
  limit: number
): Promise<Candle[]> {
  // 统一在服务层记录请求参数，方便排查扫描流程中的数据缺口。
  logger.debug({ symbol, timeframe, limit }, "Fetching market data");
  return client.fetchOHLCV(symbol, timeframe, limit);
}

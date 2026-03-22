import type { ExchangeClient } from "../../clients/exchange/ccxt-client.js";
import type { OpenInterestPoint } from "../../domain/market/open-interest.js";
import { logger } from "../../app/logger.js";

/**
 * 未平仓量（OI）拉取适配层。
 *
 * 返回最近若干个时间点的 OI 序列，供参与者压力分析判断
 * “新增仓位驱动”还是“平仓驱动”的行情结构。
 */
export async function fetchOpenInterest(
  client: ExchangeClient,
  symbol: string,
  limit: number
): Promise<OpenInterestPoint[]> {
  // 记录拉取参数，便于比对回测与实盘分析时的窗口一致性。
  logger.debug({ symbol, limit }, "Fetching open interest");
  return client.fetchOpenInterest(symbol, limit);
}

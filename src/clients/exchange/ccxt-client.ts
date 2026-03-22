import type { Candle } from "../../domain/market/candle.js";
import type { FundingRatePoint } from "../../domain/market/funding-rate.js";
import type { OpenInterestPoint } from "../../domain/market/open-interest.js";
import { logger } from "../../app/logger.js";

/**
 * 交易所数据访问接口。
 *
 * 服务层只依赖这个抽象，便于在测试中注入 mock，
 * 或在未来替换为不同的数据源实现。
 */
export interface ExchangeClient {
  fetchOHLCV(symbol: string, timeframe: string, limit: number): Promise<Candle[]>;
  fetchFundingRates(symbol: string, limit: number): Promise<FundingRatePoint[]>;
  fetchOpenInterest(symbol: string, limit: number): Promise<OpenInterestPoint[]>;
  fetchTicker(symbol: string): Promise<{ last: number }>;
  fetchSpotTicker(symbol: string): Promise<{ last: number }>;
}

/**
 * 基于 ccxt 的交易所客户端实现。
 *
 * 统一负责：
 *   1. 延迟创建交易所实例；
 *   2. 将 ccxt 原始响应规范化为系统内部领域类型；
 *   3. 对部分非关键接口失败进行降级处理。
 */
export class CcxtClient implements ExchangeClient {
  private exchange: any;
  private spotExchange: any;
  private exchangeName: string;
  private spotExchangeName: string;
  private spotSymbol: string;

  constructor(exchangeName: string, spotSymbol: string) {
    this.exchangeName = exchangeName;
    this.spotSymbol = spotSymbol;
    // 永续合约交易所名称不一定能直接用于现货行情，必要时切换到对应现货所。
    this.spotExchangeName = exchangeName === "binanceusdm" ? "binance" : exchangeName;
    // 延迟初始化：只有真正发起请求时才创建 ccxt 实例，避免启动阶段做无效连接。
    this.exchange = null;
    this.spotExchange = null;
  }

  private async getExchange(): Promise<any> {
    if (!this.exchange) {
      const ccxt = await import("ccxt");
      const ExchangeClass = (ccxt as any)[this.exchangeName];
      if (!ExchangeClass) {
        throw new Error(`Exchange not supported: ${this.exchangeName}`);
      }
      this.exchange = new ExchangeClass({ enableRateLimit: true });
    }
    return this.exchange;
  }

  private async getSpotExchange(): Promise<any> {
    if (!this.spotExchange) {
      const ccxt = await import("ccxt");
      const ExchangeClass = (ccxt as any)[this.spotExchangeName];
      if (!ExchangeClass) {
        throw new Error(`Spot exchange not supported: ${this.spotExchangeName}`);
      }
      this.spotExchange = new ExchangeClass({ enableRateLimit: true });
    }
    return this.spotExchange;
  }

  async fetchOHLCV(symbol: string, timeframe: string, limit: number): Promise<Candle[]> {
    const ex = await this.getExchange();
    const raw: any[] = await ex.fetchOHLCV(symbol, timeframe, undefined, limit);
    return raw.map((row: any[]) => ({
      timestamp: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    }));
  }

  async fetchFundingRates(symbol: string, limit: number): Promise<FundingRatePoint[]> {
    const ex = await this.getExchange();
    try {
      const raw = await ex.fetchFundingRateHistory(symbol, undefined, limit);
      return raw.map((item: any) => ({
        timestamp: Number(item.timestamp),
        fundingRate: Number(item.fundingRate),
      }));
    } catch (err) {
      logger.warn({ symbol, err }, "fetchFundingRates failed, returning empty");
      return [];
    }
  }

  async fetchOpenInterest(symbol: string, limit: number): Promise<OpenInterestPoint[]> {
    const ex = await this.getExchange();
    try {
      const raw = await ex.fetchOpenInterestHistory(symbol, "1h", undefined, limit);
      return raw.map((item: any) => ({
        timestamp: Number(item.timestamp),
        openInterest: Number(item.openInterestAmount ?? item.openInterest ?? 0),
      }));
    } catch (err) {
      logger.warn({ symbol, err }, "fetchOpenInterest failed, returning empty");
      return [];
    }
  }

  async fetchTicker(symbol: string): Promise<{ last: number }> {
    const ex = await this.getExchange();
    const ticker = await ex.fetchTicker(symbol);
    return { last: Number(ticker.last ?? 0) };
  }

  async fetchSpotTicker(symbol: string): Promise<{ last: number }> {
    try {
      const ex = await this.getSpotExchange();
      const ticker = await ex.fetchTicker(symbol);
      return { last: Number(ticker.last ?? 0) };
    } catch (err) {
      logger.warn({ symbol, err }, "fetchSpotTicker failed, returning default { last: 0 }");
      return { last: 0 };
    }
  }
}

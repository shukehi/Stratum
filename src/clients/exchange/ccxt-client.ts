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
  fetchBalance(): Promise<{ totalEquity: number; availableMargin: number }>;
  createOrder?(symbol: string, type: "market" | "limit", side: "buy" | "sell", amount: number, price?: number, params?: any): Promise<{ id: string }>;
}

type TickerLike = {
  last?: unknown;
};

type FundingRateHistoryItem = {
  timestamp?: unknown;
  fundingRate?: unknown;
};

type OpenInterestHistoryItem = {
  timestamp?: unknown;
  openInterestAmount?: unknown;
  openInterest?: unknown;
};

type ExchangeLike = {
  fetchOHLCV(
    symbol: string,
    timeframe: string,
    since: unknown,
    limit: number
  ): Promise<unknown[]>;
  fetchFundingRateHistory(
    symbol: string,
    since: unknown,
    limit: number
  ): Promise<unknown[]>;
  fetchOpenInterestHistory(
    symbol: string,
    timeframe: string,
    since: unknown,
    limit: number
  ): Promise<unknown[]>;
  fetchTicker(symbol: string): Promise<unknown>;
  fetchBalance(): Promise<unknown>;
  createOrder(symbol: string, type: string, side: string, amount: number, price?: number, params?: unknown): Promise<unknown>;
};

type ExchangeConstructor = new (options: { enableRateLimit: boolean, apiKey?: string, secret?: string }) => ExchangeLike;

/**
 * 基于 ccxt 的交易所客户端实现。
 *
 * 统一负责：
 *   1. 延迟创建交易所实例；
 *   2. 将 ccxt 原始响应规范化为系统内部领域类型；
 *   3. 对部分非关键接口失败进行降级处理。
 */
import { env } from "../../app/env.js";

export class CcxtClient implements ExchangeClient {
  private exchange: ExchangeLike | null;
  private spotExchange: ExchangeLike | null;
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

  private async getExchange(): Promise<ExchangeLike> {
    if (!this.exchange) {
      const ccxt = await import("ccxt");
      const ExchangeClass = getExchangeClass(ccxt, this.exchangeName);
      if (!ExchangeClass) {
        throw new Error(`Exchange not supported: ${this.exchangeName}`);
      }
      this.exchange = new ExchangeClass({ 
        enableRateLimit: true,
        apiKey: env.EXCHANGE_API_KEY,
        secret: env.EXCHANGE_SECRET
      });
    }
    return this.exchange;
  }

  private async getSpotExchange(): Promise<ExchangeLike> {
    if (!this.spotExchange) {
      const ccxt = await import("ccxt");
      const ExchangeClass = getExchangeClass(ccxt, this.spotExchangeName);
      if (!ExchangeClass) {
        throw new Error(`Spot exchange not supported: ${this.spotExchangeName}`);
      }
      this.spotExchange = new ExchangeClass({ enableRateLimit: true });
    }
    return this.spotExchange;
  }

  async fetchOHLCV(symbol: string, timeframe: string, limit: number): Promise<Candle[]> {
    const ex = await this.getExchange();
    const raw = await ex.fetchOHLCV(symbol, timeframe, undefined, limit);
    // DEBT_01 修复：去掉最后一根 K 线（当前尚未收盘的 forming candle）。
    // 所有下游分析（ATR、FVG、CVD、Regime）必须在已收盘的完整 K 线上运行。
    return raw.slice(0, -1).map(mapOhlcvRow);
  }

  async fetchFundingRates(symbol: string, limit: number): Promise<FundingRatePoint[]> {
    const ex = await this.getExchange();
    try {
      const raw = await ex.fetchFundingRateHistory(symbol, undefined, limit);
      return raw.map((item) => {
        const record = asObject(item) as FundingRateHistoryItem;
        return {
          timestamp: toNumber(record.timestamp),
          fundingRate: toNumber(record.fundingRate),
        };
      });
    } catch (err) {
      logger.warn({ symbol, err }, "fetchFundingRates failed, returning empty");
      return [];
    }
  }

  async fetchOpenInterest(symbol: string, limit: number): Promise<OpenInterestPoint[]> {
    const ex = await this.getExchange();
    try {
      const raw = await ex.fetchOpenInterestHistory(symbol, "1h", undefined, limit);
      return raw.map((item) => {
        const record = asObject(item) as OpenInterestHistoryItem;
        return {
          timestamp: toNumber(record.timestamp),
          openInterest: toNumber(record.openInterestAmount ?? record.openInterest ?? 0),
        };
      });
    } catch (err) {
      logger.warn({ symbol, err }, "fetchOpenInterest failed, returning empty");
      return [];
    }
  }

  async fetchTicker(symbol: string): Promise<{ last: number }> {
    const ex = await this.getExchange();
    const ticker = asObject(await ex.fetchTicker(symbol)) as TickerLike;
    return { last: toNumber(ticker.last) };
  }

  async fetchSpotTicker(symbol: string): Promise<{ last: number }> {
    try {
      const ex = await this.getSpotExchange();
      const ticker = asObject(await ex.fetchTicker(symbol)) as TickerLike;
      return { last: toNumber(ticker.last) };
    } catch (err) {
      logger.warn({ symbol, err }, "fetchSpotTicker failed, returning default { last: 0 }");
      return { last: 0 };
    }
  }

  async fetchBalance(): Promise<{ totalEquity: number; availableMargin: number }> {
    try {
      const ex = await this.getExchange();
      const rawRes = await ex.fetchBalance();
      const raw = asObject(rawRes) as {
        info: Record<string, unknown>;
        total: Record<string, unknown>;
        free: Record<string, unknown>;
      };

      // 针对常见的合约交易所解析 (Binance, Bybit 等)
      const totalEquity = toNumber(
        raw.info?.equity ??
        raw.info?.totalMarginBalance ??
        raw.total?.["USDT"] ??
        0
      );
      const availableMargin = toNumber(
        raw.info?.availableBalance ??
        raw.free?.["USDT"] ??
        0
      );

      return { totalEquity, availableMargin };
    } catch (err) {
      logger.warn({ err }, "fetchBalance failed, returning zero");
      return { totalEquity: 0, availableMargin: 0 };
    }
  }

  async createOrder(symbol: string, type: "market" | "limit", side: "buy" | "sell", amount: number, price?: number, params?: any): Promise<{ id: string }> {
    const ex = await this.getExchange();
    const order = asObject(await ex.createOrder(symbol, type, side, amount, price, params));
    return { id: String(order.id) };
  }
}

function getExchangeClass(module: unknown, exchangeName: string): ExchangeConstructor | null {
  if (!module || typeof module !== "object") return null;
  const candidate = (module as Record<string, unknown>)[exchangeName];
  return typeof candidate === "function" ? (candidate as ExchangeConstructor) : null;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function toNumber(value: unknown): number {
  return Number(value ?? 0);
}

function mapOhlcvRow(row: unknown): Candle {
  if (!Array.isArray(row) || row.length < 6) {
    throw new Error("Invalid OHLCV row from exchange");
  }
  return {
    timestamp: toNumber(row[0]),
    open: toNumber(row[1]),
    high: toNumber(row[2]),
    low: toNumber(row[3]),
    close: toNumber(row[4]),
    volume: toNumber(row[5]),
  };
}

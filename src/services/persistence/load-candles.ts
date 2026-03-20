import Database from "better-sqlite3";
import type { Candle } from "../../domain/market/candle.js";

/**
 * K 线读取  (PHASE_15)
 *
 * 从本地 SQLite 读取历史 K 线数据，供回测 CLI 使用。
 * 避免每次回测都重新从交易所拉取数据，节省时间和 API 请求。
 *
 * 新鲜度判断：
 *   4h K线 → 最新一根不超过 4h 前 = 新鲜
 *   1h K线 → 最新一根不超过 1h 前 = 新鲜
 */

// ── 主查询 ────────────────────────────────────────────────────────────────────

/**
 * 读取最近 limit 根 K 线，按时间升序返回（最旧在前，最新在后）。
 */
export function loadCandles(
  db: Database.Database,
  symbol: string,
  timeframe: string,
  limit: number
): Candle[] {
  const rows = db.prepare(`
    SELECT timestamp, open, high, low, close, volume
    FROM candles
    WHERE symbol = ? AND timeframe = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(symbol, timeframe, limit) as Array<{
    timestamp: number; open: number; high: number;
    low: number; close: number; volume: number;
  }>;

  // DESC 查出来再反转 → 升序（时间从旧到新）
  return rows.reverse().map((r) => ({
    timestamp: r.timestamp,
    open:      r.open,
    high:      r.high,
    low:       r.low,
    close:     r.close,
    volume:    r.volume,
  }));
}

/**
 * 返回指定品种/时间周期的最新 K 线时间戳，没有记录时返回 null。
 * 用于判断本地数据是否足够新鲜。
 */
export function getLatestCandleTimestamp(
  db: Database.Database,
  symbol: string,
  timeframe: string
): number | null {
  const row = db.prepare(`
    SELECT MAX(timestamp) AS latest
    FROM candles
    WHERE symbol = ? AND timeframe = ?
  `).get(symbol, timeframe) as { latest: number | null };

  return row.latest ?? null;
}

/**
 * 返回本地存储的 K 线数量。
 */
export function countCandles(
  db: Database.Database,
  symbol: string,
  timeframe: string
): number {
  const row = db.prepare(`
    SELECT COUNT(*) AS cnt FROM candles WHERE symbol = ? AND timeframe = ?
  `).get(symbol, timeframe) as { cnt: number };
  return row.cnt;
}

// ── 新鲜度判断 ────────────────────────────────────────────────────────────────

const TIMEFRAME_MS: Record<string, number> = {
  "1h":  1 * 60 * 60 * 1000,
  "4h":  4 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
};

/**
 * 判断本地 K 线是否新鲜（最新一根在一个周期内）。
 * 新鲜 = 可以直接用 DB 数据做回测，无需重新联网拉取。
 */
export function isCandleDataFresh(
  db: Database.Database,
  symbol: string,
  timeframe: string,
  requiredCount: number
): boolean {
  const count = countCandles(db, symbol, timeframe);
  if (count < requiredCount) return false;

  const latest = getLatestCandleTimestamp(db, symbol, timeframe);
  if (latest === null) return false;

  // 注意：未在 TIMEFRAME_MS 登记的时间框架（如 "1w"）会回退到 4h 间隔；
  // 支持新时间框架时需先在 TIMEFRAME_MS 中添加对应毫秒数。
  const intervalMs = TIMEFRAME_MS[timeframe] ?? TIMEFRAME_MS["4h"];
  return Date.now() - latest <= intervalMs;
}

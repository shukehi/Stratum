import Database from "better-sqlite3";
import type { Candle } from "../../domain/market/candle.js";

/**
 * K 线持久化  (PHASE_15)
 *
 * 将 OHLCV 数组批量写入 candles 表。
 * 使用 INSERT OR REPLACE：同一 (symbol, timeframe, timestamp) 的记录会被最新数据覆盖。
 * 这确保最近一根未收盘的 K 线数据始终是最新的。
 *
 * 使用事务批量写入，500 根 K 线约 5ms。
 */
export function saveCandles(
  db: Database.Database,
  symbol: string,
  timeframe: string,
  candles: Candle[]
): void {
  if (candles.length === 0) return;

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO candles (symbol, timeframe, timestamp, open, high, low, close, volume)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((rows: Candle[]) => {
    for (const c of rows) {
      stmt.run(symbol, timeframe, c.timestamp, c.open, c.high, c.low, c.close, c.volume);
    }
  });

  insertMany(candles);
}

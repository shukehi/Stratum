import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initDb } from "../../../src/services/persistence/init-db.js";
import { saveCandles } from "../../../src/services/persistence/save-candles.js";
import {
  loadCandles,
  getLatestCandleTimestamp,
  countCandles,
  isCandleDataFresh,
} from "../../../src/services/persistence/load-candles.js";
import type { Candle } from "../../../src/domain/market/candle.js";

// ── 测试辅助 ──────────────────────────────────────────────────────────────────

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  initDb(db);
  return db;
}

function makeCandles(count: number, startTs = 1_000_000): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: startTs + i * 4 * 60 * 60 * 1000, // 4h 间隔
    open:  100 + i,
    high:  110 + i,
    low:   90  + i,
    close: 105 + i,
    volume: 1000 + i,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────

describe("saveCandles", () => {
  it("批量写入后 countCandles 返回正确数量", () => {
    const db = makeDb();
    saveCandles(db, "BTCUSDT", "4h", makeCandles(10));
    expect(countCandles(db, "BTCUSDT", "4h")).toBe(10);
  });

  it("空数组不报错", () => {
    const db = makeDb();
    expect(() => saveCandles(db, "BTCUSDT", "4h", [])).not.toThrow();
    expect(countCandles(db, "BTCUSDT", "4h")).toBe(0);
  });

  it("INSERT OR REPLACE：相同时间戳覆盖旧数据", () => {
    const db = makeDb();
    const original: Candle[] = [{ timestamp: 1000, open: 100, high: 110, low: 90, close: 105, volume: 500 }];
    const updated:  Candle[] = [{ timestamp: 1000, open: 200, high: 220, low: 180, close: 210, volume: 999 }];

    saveCandles(db, "BTCUSDT", "4h", original);
    saveCandles(db, "BTCUSDT", "4h", updated);

    const loaded = loadCandles(db, "BTCUSDT", "4h", 1);
    expect(loaded[0].close).toBe(210);   // 新值
    expect(countCandles(db, "BTCUSDT", "4h")).toBe(1); // 没有增加
  });

  it("不同品种互不影响", () => {
    const db = makeDb();
    saveCandles(db, "BTCUSDT", "4h", makeCandles(5));
    saveCandles(db, "ETHUSDT", "4h", makeCandles(3));
    expect(countCandles(db, "BTCUSDT", "4h")).toBe(5);
    expect(countCandles(db, "ETHUSDT", "4h")).toBe(3);
  });

  it("不同时间周期互不影响", () => {
    const db = makeDb();
    saveCandles(db, "BTCUSDT", "4h", makeCandles(10));
    saveCandles(db, "BTCUSDT", "1h", makeCandles(20));
    expect(countCandles(db, "BTCUSDT", "4h")).toBe(10);
    expect(countCandles(db, "BTCUSDT", "1h")).toBe(20);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("loadCandles", () => {
  it("按时间升序返回（最旧在前）", () => {
    const db = makeDb();
    saveCandles(db, "BTCUSDT", "4h", makeCandles(5));
    const loaded = loadCandles(db, "BTCUSDT", "4h", 5);
    expect(loaded[0].timestamp).toBeLessThan(loaded[4].timestamp);
  });

  it("limit 参数限制返回数量（取最新的 N 根）", () => {
    const db = makeDb();
    saveCandles(db, "BTCUSDT", "4h", makeCandles(20));
    const loaded = loadCandles(db, "BTCUSDT", "4h", 5);
    expect(loaded).toHaveLength(5);
    // 应该是最新的 5 根（索引 15-19）
    const all = makeCandles(20);
    expect(loaded[0].timestamp).toBe(all[15].timestamp);
  });

  it("没有数据时返回空数组", () => {
    const db = makeDb();
    expect(loadCandles(db, "BTCUSDT", "4h", 10)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("getLatestCandleTimestamp", () => {
  it("返回最大时间戳", () => {
    const db = makeDb();
    const candles = makeCandles(5);
    saveCandles(db, "BTCUSDT", "4h", candles);
    expect(getLatestCandleTimestamp(db, "BTCUSDT", "4h"))
      .toBe(candles[4].timestamp);
  });

  it("无数据时返回 null", () => {
    const db = makeDb();
    expect(getLatestCandleTimestamp(db, "BTCUSDT", "4h")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("isCandleDataFresh", () => {
  it("数据足够且最新根在 4h 内 → true", () => {
    const db = makeDb();
    const now = Date.now();
    // 最后一根 K 线时间戳为 1 小时前（仍在 4h 周期内）
    const candles = makeCandles(10, now - 9 * 4 * 3_600_000);
    candles[candles.length - 1] = { ...candles[candles.length - 1], timestamp: now - 3_600_000 };
    saveCandles(db, "BTCUSDT", "4h", candles);
    expect(isCandleDataFresh(db, "BTCUSDT", "4h", 10)).toBe(true);
  });

  it("最新根超过 4h 前 → false（数据过期）", () => {
    const db = makeDb();
    // 起始时间为 48h 前，10 根 4h K线，最后一根在 48h - 9*4h = 12h 前，明显过期
    const old = makeCandles(10, Date.now() - 48 * 3_600_000);
    saveCandles(db, "BTCUSDT", "4h", old);
    expect(isCandleDataFresh(db, "BTCUSDT", "4h", 10)).toBe(false);
  });

  it("数量不足 → false", () => {
    const db = makeDb();
    const now = Date.now();
    const candles = makeCandles(5, now - 5 * 4 * 3_600_000);
    candles[candles.length - 1] = { ...candles[candles.length - 1], timestamp: now - 1000 };
    saveCandles(db, "BTCUSDT", "4h", candles);
    expect(isCandleDataFresh(db, "BTCUSDT", "4h", 100)).toBe(false); // 需要 100 根但只有 5
  });

  it("无数据 → false", () => {
    const db = makeDb();
    expect(isCandleDataFresh(db, "BTCUSDT", "4h", 10)).toBe(false);
  });
});

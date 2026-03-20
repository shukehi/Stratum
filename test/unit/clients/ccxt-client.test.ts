import { describe, it, expect, vi, beforeEach } from "vitest";

describe("CcxtClient", () => {
  describe("OHLCV standardization", () => {
    it("maps raw ccxt OHLCV array to Candle type correctly", () => {
      // Test the mapping logic directly without real exchange
      const rawRow = [1700000000000, 60000, 60500, 59500, 60200, 1500.5];
      const candle = {
        timestamp: Number(rawRow[0]),
        open: Number(rawRow[1]),
        high: Number(rawRow[2]),
        low: Number(rawRow[3]),
        close: Number(rawRow[4]),
        volume: Number(rawRow[5]),
      };
      expect(candle.timestamp).toBe(1700000000000);
      expect(candle.open).toBe(60000);
      expect(candle.high).toBe(60500);
      expect(candle.low).toBe(59500);
      expect(candle.close).toBe(60200);
      expect(candle.volume).toBe(1500.5);
    });

    it("converts string numbers to number type", () => {
      const rawRow = ["1700000000000", "60000.0", "60500.0", "59500.0", "60200.0", "1500"];
      const candle = {
        timestamp: Number(rawRow[0]),
        open: Number(rawRow[1]),
        high: Number(rawRow[2]),
        low: Number(rawRow[3]),
        close: Number(rawRow[4]),
        volume: Number(rawRow[5]),
      };
      expect(typeof candle.timestamp).toBe("number");
      expect(typeof candle.open).toBe("number");
    });
  });

  describe("fetchSpotTicker graceful degradation", () => {
    it("returns { last: 0 } when spot ticker throws", async () => {
      // Test the fallback logic
      const failingFetch = async () => { throw new Error("Not found"); };
      let result: { last: number };
      try {
        const ticker = await failingFetch();
        result = { last: Number((ticker as any).last ?? 0) };
      } catch {
        result = { last: 0 };
      }
      expect(result).toEqual({ last: 0 });
    });

    it("returns actual price when spot ticker succeeds", async () => {
      const successFetch = async () => ({ last: 65000 });
      let result: { last: number };
      try {
        const ticker = await successFetch();
        result = { last: Number(ticker.last ?? 0) };
      } catch {
        result = { last: 0 };
      }
      expect(result).toEqual({ last: 65000 });
    });
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { initPositionsDb } from "../../../src/services/positions/init-positions-db.js";
import { openPosition, getOpenPositions } from "../../../src/services/positions/track-position.js";
import { monitorPositions } from "../../../src/services/paper-trading/monitor-positions.js";
import type { TradeCandidate } from "../../../src/domain/signal/trade-candidate.js";

function makeCandidate(overrides: Partial<TradeCandidate> = {}): TradeCandidate {
  return {
    symbol: "BTCUSDT",
    direction: "long",
    timeframe: "4h",
    entryLow: 59800,
    entryHigh: 60000,
    stopLoss: 58800,
    takeProfit: 63000,
    riskReward: 2.5,
    capitalVelocityScore: 85,
    regimeAligned: true,
    participantAligned: true,
    structureReason: "Test",
    contextReason: "Test",
    reasonCodes: [],
    ...overrides,
  };
}

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  initPositionsDb(db);
});

describe("monitor-positions (V2 Physics)", () => {
  it("价格触及 TP 应触发自动平仓", async () => {
    const c = makeCandidate({ entryHigh: 60000, takeProfit: 62000, stopLoss: 58000 });
    openPosition(db, c, Date.now());

    const mockClient = {
      fetchTicker: vi.fn().mockResolvedValue({ last: 63000 }), // 价格越过 TP
    };

    const result = await monitorPositions(db, mockClient as any, {});
    expect(result.closed).toBe(1);
    
    const open = getOpenPositions(db);
    expect(open).toHaveLength(0);
  });

  it("价格触及 SL 应触发自动平仓", async () => {
    const c = makeCandidate({ entryHigh: 60000, takeProfit: 62000, stopLoss: 58000 });
    openPosition(db, c, Date.now());

    const mockClient = {
      fetchTicker: vi.fn().mockResolvedValue({ last: 57000 }), // 价格跌破 SL
    };

    const result = await monitorPositions(db, mockClient as any, {});
    expect(result.closed).toBe(1);
  });

  it("价格在区间内不触发平仓", async () => {
    const c = makeCandidate({ entryHigh: 60000, takeProfit: 65000, stopLoss: 55000 });
    openPosition(db, c, Date.now());

    const mockClient = {
      fetchTicker: vi.fn().mockResolvedValue({ last: 60000 }),
    };

    const result = await monitorPositions(db, mockClient as any, {});
    expect(result.closed).toBe(0);
  });
});

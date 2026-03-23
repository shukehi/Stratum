import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initPositionsDb } from "../../../src/services/positions/init-positions-db.js";
import {
  openPosition,
  closePosition,
  getOpenPositions,
  getOpenRiskSummary,
  countOpenByDirection,
  findPosition,
} from "../../../src/services/positions/track-position.js";
import { buildId } from "../../../src/services/persistence/save-candidate.js";
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

describe("track-position (V2 Physics)", () => {
  describe("buildId 对齐校验", () => {
    it("ID 生成逻辑应保持物理一致性", () => {
      const id = buildId("BTCUSDT", "long", "4h", 60000);
      expect(id).toContain("BTCUSDT_long_4h");
    });
  });

  describe("仓位生命周期", () => {
    it("openPosition: 成功持久化 CVS 分值", () => {
      const c = makeCandidate({ symbol: "OPEN_TEST", capitalVelocityScore: 95 });
      openPosition(db, c, Date.now());
      const pos = findPosition(db, "OPEN_TEST", "long", "4h", 60000);
      expect(pos).toBeDefined();
      expect(pos?.capitalVelocityScore).toBe(95);
      expect(pos?.status).toBe("open");
    });

    it("closePosition: 正确计算 R 倍数盈亏", () => {
      const c = makeCandidate({ 
        entryLow: 100, entryHigh: 100, stopLoss: 90, takeProfit: 120,
        capitalVelocityScore: 80 
      });
      openPosition(db, c, Date.now());
      // entryMid = 100, risk = 10. 平仓 110 应为 +1.0R
      closePosition(db, c.symbol, c.direction, c.timeframe, 100, 110, "closed_tp");
      const pos = findPosition(db, c.symbol, c.direction, c.timeframe, 100);
      expect(pos?.status).toBe("closed_tp");
      expect(pos?.pnlR).toBeCloseTo(1.0);
    });
  });

  describe("风险汇总", () => {
    it("getOpenRiskSummary: 正确汇总活跃仓位风险", () => {
      openPosition(db, makeCandidate({ symbol: "C1" }), Date.now(), { accountRiskPercent: 1.5 });
      openPosition(db, makeCandidate({ symbol: "C2", direction: "short" }), Date.now(), { accountRiskPercent: 1.0 });
      
      const global = getOpenRiskSummary(db);
      expect(global.openCount).toBe(2);
      expect(global.openRiskPercent).toBe(2.5);

      const longs = getOpenRiskSummary(db, "long");
      expect(longs.openCount).toBe(1);
      expect(longs.openRiskPercent).toBe(1.5);
    });
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initDb } from "../../../src/services/persistence/init-db.js";
import { initPositionsDb } from "../../../src/services/positions/init-positions-db.js";
import { saveScanLog } from "../../../src/services/persistence/save-scan-log.js";
import {
  saveCandidateSnapshot,
  updateCandidateSnapshotOutcome,
} from "../../../src/services/persistence/save-candidate.js";
import { openPosition, closePosition } from "../../../src/services/positions/track-position.js";
import {
  getOverallStats,
  getWinRateByGrade,
  getWinRateByDirection,
  getWinRateByStructureType,
  getRecentScanLogs,
  getExecutionFunnelStats,
  getOpenExposureByDirection,
  getRecentRiskSnapshots,
  getScanBreakdownByRegime,
  getScanBreakdownByParticipantPressure,
  getCandidateSnapshotBreakdownByConfirmationStatus,
  getCandidateSnapshotBreakdownByExecutionOutcome,
  getCandidateSnapshotBreakdownByExecutionReason,
  getExecutionBreakdownByRegime,
  getExecutionBreakdownByParticipantPressure,
  getOutcomeBreakdownByRegime,
  getOutcomeBreakdownByParticipantPressure,
  getOutcomeBreakdownByDailyBias,
  getOutcomeBreakdownByOrderFlowBias,
  getOutcomeBreakdownByLiquiditySession,
  getOutcomeWindowRows,
} from "../../../src/services/analytics/query-trade-report.js";
import type { SignalScanResult } from "../../../src/services/orchestrator/run-signal-scan.js";
import type { TradeCandidate } from "../../../src/domain/signal/trade-candidate.js";

// ── 测试夹具 ─────────────────────────────────────────────────────────────────

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  initDb(db);
  initPositionsDb(db);
  return db;
}

function makeScanResult(overrides: Partial<SignalScanResult> = {}): SignalScanResult {
  return {
    symbol: "BTCUSDT",
    scannedAt: Date.now(),
    candidatesFound: 2,
    alertsSent: 1,
    alertsFailed: 0,
    alertsSkipped: 1,
    regime: "trend",
    participantPressureType: "none",
    dailyBias: "neutral",
    orderFlowBias: "neutral",
    basisDivergence: false,
    marketDriverType: "new-longs",
    errors: [],
    ...overrides,
  };
}

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
    structureReason: "看涨FVG",
    contextReason: "trend",
    reasonCodes: [],
    ...overrides,
  };
}

let db: Database.Database;

beforeEach(() => {
  db = makeDb();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("query-trade-report (V2 Physics)", () => {
  it("getOverallStats: 统计基本物理指标", () => {
    saveScanLog(db, makeScanResult());
    const stats = getOverallStats(db);
    expect(stats.totalScans).toBe(1);
  });

  it("getExecutionFunnelStats: 统计执行漏斗（无宏观拦截）", () => {
    const p = { candidate: makeCandidate(), marketContext: {} as any, alertStatus: "sent" as any, createdAt: Date.now() };
    saveCandidateSnapshot(db, p, { executionOutcome: "sent" });
    const funnel = getExecutionFunnelStats(db);
    expect(funnel.totalSnapshots).toBe(1);
    expect(funnel.sent).toBe(1);
  });

  it("getWinRateByGrade: 按 CVS 动能分桶统计胜率", () => {
    const c = makeCandidate({ capitalVelocityScore: 90 });
    openPosition(db, c, Date.now(), { riskAmount: 100, accountRiskPercent: 1 });
    closePosition(db, c.symbol, c.direction, c.timeframe, c.entryHigh, 62000, "closed_tp");
    
    const rows = getWinRateByGrade(db);
    expect(rows.length).toBe(1);
    expect(rows[0].label).toBe("90");
    expect(rows[0].winRate).toBe(1);
  });
});

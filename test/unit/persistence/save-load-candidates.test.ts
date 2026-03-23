import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initDb } from "../../../src/services/persistence/init-db.js";
import {
  saveCandidate,
  saveCandidateSnapshot,
  loadCandidateSnapshots,
  updateCandidateSnapshotOutcome,
  updateAlertStatus,
  buildId,
} from "../../../src/services/persistence/save-candidate.js";
import { findCandidate } from "../../../src/services/persistence/load-candidates.js";
import type { AlertPayload } from "../../../src/domain/signal/alert-payload.js";
import type { TradeCandidate } from "../../../src/domain/signal/trade-candidate.js";
import type { MarketContext } from "../../../src/domain/market/market-context.js";

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
    capitalVelocityScore: 85.5,
    regimeAligned: true,
    participantAligned: true,
    structureReason: "Test",
    contextReason: "Test",
    reasonCodes: [],
    ...overrides,
  };
}

function makeCtx(): MarketContext {
  return {
    regime: "trend",
    regimeConfidence: 80,
    regimeReasons: [],
    participantBias: "balanced",
    participantPressureType: "balanced",
    participantConfidence: 80,
    participantRationale: "",
    spotPerpBasis: 0,
    basisDivergence: false,
    liquiditySession: "london_ramp",
    summary: "Test",
    reasonCodes: [],
  };
}

function makePayload(overrides: Partial<TradeCandidate> = {}): AlertPayload {
  return {
    candidate: makeCandidate(overrides),
    marketContext: makeCtx(),
    alertStatus: "sent",
    createdAt: Date.now(),
  };
}

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  initDb(db);
});

describe("save-load-candidates (V2 Physics)", () => {
  it("saveCandidate: 成功保存 CVS 物理分值", () => {
    saveCandidate(db, makePayload({ capitalVelocityScore: 92.5 }));
    const row = db.prepare("SELECT capital_velocity_score FROM candidates").get() as any;
    expect(row.capital_velocity_score).toBe(92.5);
  });

  it("candidate_snapshots: 能够加载快照序列", () => {
    saveCandidateSnapshot(db, makePayload({ symbol: "S1" }));
    saveCandidateSnapshot(db, makePayload({ symbol: "S2" }));
    const rows = loadCandidateSnapshots(db);
    expect(rows).toHaveLength(2);
    expect(rows[0].symbol).toBe("S2");
  });

  it("findCandidate: 能够通过物理指纹找回信号", () => {
    saveCandidate(db, makePayload({ symbol: "TARGET", entryHigh: 60000 }));
    const res = findCandidate(db, "TARGET", "long", "4h", 60000);
    expect(res).toBeDefined();
    expect(res?.candidate.capitalVelocityScore).toBe(85.5);
  });
});

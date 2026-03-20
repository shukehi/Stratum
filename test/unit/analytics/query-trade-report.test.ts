import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initDb } from "../../../src/services/persistence/init-db.js";
import { initPositionsDb } from "../../../src/services/positions/init-positions-db.js";
import { saveScanLog } from "../../../src/services/persistence/save-scan-log.js";
import { openPosition, closePosition } from "../../../src/services/positions/track-position.js";
import {
  getOverallStats,
  getWinRateByGrade,
  getWinRateByDirection,
  getWinRateByStructureType,
  getRecentScanLogs,
  getMacroFilterStats,
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
    candidatesAfterMacro: 2,
    alertsSent: 1,
    alertsFailed: 0,
    alertsSkipped: 1,
    macroAction: "pass",
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
    signalGrade: "high-conviction",
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

// ── saveScanLog ───────────────────────────────────────────────────────────────

describe("saveScanLog", () => {
  it("scan_logs に 1 件挿入される", () => {
    saveScanLog(db, makeScanResult());
    const count = db.prepare("SELECT COUNT(*) as n FROM scan_logs").get() as { n: number };
    expect(count.n).toBe(1);
  });

  it("すべてのフィールドが正しく保存される", () => {
    const result = makeScanResult({
      symbol: "ETHUSDT",
      candidatesFound: 3,
      alertsSent: 2,
      macroAction: "block",
      errors: ["news failed"],
    });
    saveScanLog(db, result);
    const row = db.prepare("SELECT * FROM scan_logs").get() as any;
    expect(row.symbol).toBe("ETHUSDT");
    expect(row.candidates_found).toBe(3);
    expect(row.alerts_sent).toBe(2);
    expect(row.macro_action).toBe("block");
    expect(row.errors_count).toBe(1);
    expect(JSON.parse(row.errors_json)).toEqual(["news failed"]);
  });

  it("複数回呼んでも全件保存される（AUTO INCREMENT）", () => {
    saveScanLog(db, makeScanResult());
    saveScanLog(db, makeScanResult());
    saveScanLog(db, makeScanResult());
    const count = db.prepare("SELECT COUNT(*) as n FROM scan_logs").get() as { n: number };
    expect(count.n).toBe(3);
  });
});

// ── getOverallStats — 空 DB ───────────────────────────────────────────────────

describe("getOverallStats — 空データ", () => {
  it("空 DB → 全項目ゼロ", () => {
    const stats = getOverallStats(db);
    expect(stats.totalScans).toBe(0);
    expect(stats.totalSignalsSent).toBe(0);
    expect(stats.totalPositionsClosed).toBe(0);
    expect(stats.winRate).toBe(0);
    expect(stats.avgPnlR).toBe(0);
    expect(stats.totalR).toBe(0);
  });
});

// ── getOverallStats — データあり ──────────────────────────────────────────────

describe("getOverallStats — データあり", () => {
  beforeEach(() => {
    // 3 回スキャン（pass/block/downgrade）
    saveScanLog(db, makeScanResult({ macroAction: "pass", alertsSent: 1 }));
    saveScanLog(db, makeScanResult({ macroAction: "block", alertsSent: 0 }));
    saveScanLog(db, makeScanResult({ macroAction: "downgrade", alertsSent: 1 }));

    // 2 件の仓位：1 勝 1 敗
    openPosition(db, makeCandidate({ symbol: "BTCUSDT" }));
    openPosition(db, makeCandidate({ symbol: "ETHUSDT", entryHigh: 3100 }));
    closePosition(db, "BTCUSDT", "long", "4h", 60000, 63000, "closed_tp");
    closePosition(db, "ETHUSDT", "long", "4h", 3100, 2900, "closed_sl");
  });

  it("totalScans = 3", () => {
    expect(getOverallStats(db).totalScans).toBe(3);
  });

  it("totalSignalsSent = 2", () => {
    expect(getOverallStats(db).totalSignalsSent).toBe(2);
  });

  it("totalPositionsClosed = 2", () => {
    expect(getOverallStats(db).totalPositionsClosed).toBe(2);
  });

  it("wins = 1, losses = 1", () => {
    const stats = getOverallStats(db);
    expect(stats.wins).toBe(1);
    expect(stats.losses).toBe(1);
  });

  it("winRate = 0.5", () => {
    expect(getOverallStats(db).winRate).toBeCloseTo(0.5);
  });

  it("macroBlockCount = 1, macroDowngradeCount = 1", () => {
    const stats = getOverallStats(db);
    expect(stats.macroBlockCount).toBe(1);
    expect(stats.macroDowngradeCount).toBe(1);
  });
});

// ── getWinRateByGrade ────────────────────────────────────────────────────────

describe("getWinRateByGrade", () => {
  it("データなし → 空配列", () => {
    expect(getWinRateByGrade(db)).toHaveLength(0);
  });

  it("high-conviction と standard で分けて集計される", () => {
    openPosition(db, makeCandidate({ signalGrade: "high-conviction" }));
    openPosition(db, makeCandidate({ symbol: "ETHUSDT", entryHigh: 3100, signalGrade: "standard" }));
    closePosition(db, "BTCUSDT", "long", "4h", 60000, 63000, "closed_tp");
    closePosition(db, "ETHUSDT", "long", "4h", 3100, 2900, "closed_sl");

    const rows = getWinRateByGrade(db);
    expect(rows).toHaveLength(2);
    const hc = rows.find((r) => r.label === "high-conviction");
    const std = rows.find((r) => r.label === "standard");
    expect(hc?.winRate).toBe(1.0);
    expect(std?.winRate).toBe(0.0);
  });
});

// ── getWinRateByDirection ────────────────────────────────────────────────────

describe("getWinRateByDirection", () => {
  it("long/short の勝率が別々に集計される", () => {
    openPosition(db, makeCandidate({ direction: "long" }));
    openPosition(
      db,
      makeCandidate({
        symbol: "ETHUSDT",
        direction: "short",
        entryHigh: 3100,
        stopLoss: 3200,
        takeProfit: 2800,
      })
    );
    closePosition(db, "BTCUSDT", "long", "4h", 60000, 63000, "closed_tp");
    closePosition(db, "ETHUSDT", "short", "4h", 3100, 2800, "closed_tp");

    const rows = getWinRateByDirection(db);
    expect(rows.every((r) => r.winRate === 1.0)).toBe(true);
    expect(rows).toHaveLength(2);
  });
});

// ── getWinRateByStructureType ─────────────────────────────────────────────────

describe("getWinRateByStructureType", () => {
  it("データなし（candidates JOIN なし）→ 空配列", () => {
    // positions はあるが candidates がないため JOIN 結果は空
    openPosition(db, makeCandidate());
    closePosition(db, "BTCUSDT", "long", "4h", 60000, 63000, "closed_tp");
    // candidates テーブルには何も入れていないので JOIN 結果は空
    expect(getWinRateByStructureType(db)).toHaveLength(0);
  });
});

// ── getRecentScanLogs ────────────────────────────────────────────────────────

describe("getRecentScanLogs", () => {
  it("データなし → 空配列", () => {
    expect(getRecentScanLogs(db)).toHaveLength(0);
  });

  it("5 件挿入後、デフォルト 50 件取得 → 5 件", () => {
    for (let i = 0; i < 5; i++) {
      saveScanLog(db, makeScanResult({ scannedAt: 1000 + i }));
    }
    expect(getRecentScanLogs(db)).toHaveLength(5);
  });

  it("limit=2 → 最新 2 件のみ", () => {
    for (let i = 0; i < 5; i++) {
      saveScanLog(db, makeScanResult({ scannedAt: 1000 + i }));
    }
    const logs = getRecentScanLogs(db, 2);
    expect(logs).toHaveLength(2);
    // 降順（最新が先頭）
    expect(logs[0].scannedAt).toBeGreaterThan(logs[1].scannedAt);
  });

  it("フィールドが正しくマッピングされる", () => {
    saveScanLog(db, makeScanResult({ symbol: "BTCUSDT", macroAction: "block", errorsCount: 0 } as any));
    const logs = getRecentScanLogs(db);
    expect(logs[0].symbol).toBe("BTCUSDT");
    expect(logs[0].macroAction).toBe("block");
  });
});

// ── getMacroFilterStats ───────────────────────────────────────────────────────

describe("getMacroFilterStats", () => {
  it("データなし → 空配列", () => {
    expect(getMacroFilterStats(db)).toHaveLength(0);
  });

  it("pass/block/downgrade の件数が集計される", () => {
    saveScanLog(db, makeScanResult({ macroAction: "pass" }));
    saveScanLog(db, makeScanResult({ macroAction: "pass" }));
    saveScanLog(db, makeScanResult({ macroAction: "block", candidatesFound: 3, candidatesAfterMacro: 0 }));
    saveScanLog(db, makeScanResult({ macroAction: "downgrade" }));

    const stats = getMacroFilterStats(db);
    const passRow = stats.find((r) => r.macroAction === "pass");
    const blockRow = stats.find((r) => r.macroAction === "block");
    expect(passRow?.scanCount).toBe(2);
    expect(blockRow?.scanCount).toBe(1);
    expect(blockRow?.totalCandidatesBlocked).toBe(3); // 3 found - 0 after macro
  });
});

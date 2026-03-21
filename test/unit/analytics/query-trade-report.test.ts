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
  getMacroFilterStats,
  getPositionSizingStats,
  getExecutionFunnelStats,
  getOpenExposureByDirection,
  getRecentRiskSnapshots,
  getScanBreakdownByRegime,
  getScanBreakdownByParticipantPressure,
  getScanBreakdownBySkipStage,
  getCandidateSnapshotBreakdownByMacroAction,
  getCandidateSnapshotBreakdownByConfirmationStatus,
  getCandidateSnapshotBreakdownByExecutionOutcome,
  getCandidateSnapshotBreakdownByExecutionReason,
  getExecutionBreakdownByRegime,
  getExecutionBreakdownByParticipantPressure,
  getExecutionBreakdownByMacroAction,
  getOutcomeBreakdownByRegime,
  getOutcomeBreakdownByParticipantPressure,
  getOutcomeBreakdownByMacroAction,
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
    candidatesAfterMacro: 2,
    alertsSent: 1,
    alertsFailed: 0,
    alertsSkipped: 1,
    macroAction: "pass",
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
    saveScanLog(
      db,
      makeScanResult({
        symbol: "BTCUSDT",
        macroAction: "block",
        skipStage: "macro",
        skipReasonCode: "MACRO_BLOCKED",
      } as any)
    );
    const logs = getRecentScanLogs(db);
    expect(logs[0].symbol).toBe("BTCUSDT");
    expect(logs[0].macroAction).toBe("block");
    expect(logs[0].skipStage).toBe("macro");
  });
});

// ── getMacroFilterStats ───────────────────────────────────────────────────────

describe("getMacroFilterStats", () => {
  it("データなし → 空配列", () => {
    expect(getMacroFilterStats(db)).toHaveLength(0);
  });

  it("candidate-level macro action と执行结果会按快照聚合", () => {
    const now = Date.now();
    const passId = saveCandidateSnapshot(
      db,
      {
        candidate: makeCandidate(),
        marketContext: {
          regime: "trend",
          regimeConfidence: 70,
          regimeReasons: [],
          participantBias: "balanced",
          participantPressureType: "none",
          participantConfidence: 68,
          participantRationale: "",
          spotPerpBasis: 0,
          basisDivergence: false,
          liquiditySession: "ny_close",
          summary: "",
          reasonCodes: [],
        },
        alertStatus: "pending",
        createdAt: now,
      },
      { macroAction: "pass", confirmationStatus: "confirmed" }
    );
    updateCandidateSnapshotOutcome(db, passId, "sent", { alertStatus: "sent" });

    saveCandidateSnapshot(
      db,
      {
        candidate: makeCandidate({ symbol: "ETHUSDT", entryHigh: 3100 }),
        marketContext: {
          regime: "trend",
          regimeConfidence: 70,
          regimeReasons: [],
          participantBias: "balanced",
          participantPressureType: "none",
          participantConfidence: 68,
          participantRationale: "",
          spotPerpBasis: 0,
          basisDivergence: false,
          liquiditySession: "ny_close",
          summary: "",
          reasonCodes: [],
        },
        alertStatus: "blocked_by_macro",
        createdAt: now + 1,
      },
      { macroAction: "block", confirmationStatus: "pending" }
    );

    saveCandidateSnapshot(
      db,
      {
        candidate: makeCandidate({ symbol: "SOLUSDT", entryHigh: 150, entryLow: 148 }),
        marketContext: {
          regime: "range",
          regimeConfidence: 60,
          regimeReasons: [],
          participantBias: "balanced",
          participantPressureType: "none",
          participantConfidence: 60,
          participantRationale: "",
          spotPerpBasis: 0,
          basisDivergence: false,
          liquiditySession: "asian_low",
          summary: "",
          reasonCodes: [],
        },
        alertStatus: "pending",
        createdAt: now + 2,
      },
      {
        macroAction: "downgrade",
        confirmationStatus: "confirmed",
        executionOutcome: "failed",
      }
    );

    const stats = getMacroFilterStats(db);
    expect(stats.find((r) => r.macroAction === "pass")).toMatchObject({
      snapshotCount: 1,
      blockedCount: 0,
      sentCount: 1,
      skippedOrFailedCount: 0,
    });
    expect(stats.find((r) => r.macroAction === "block")).toMatchObject({
      snapshotCount: 1,
      blockedCount: 1,
      sentCount: 0,
      skippedOrFailedCount: 0,
    });
    expect(stats.find((r) => r.macroAction === "downgrade")).toMatchObject({
      snapshotCount: 1,
      blockedCount: 0,
      sentCount: 0,
      skippedOrFailedCount: 1,
    });
  });
});

describe("phase 32 breakdown queries", () => {
  beforeEach(() => {
    saveScanLog(db, makeScanResult({
      regime: "trend",
      participantPressureType: "squeeze-risk",
      skipStage: "none" as any,
    }));
    saveScanLog(db, makeScanResult({
      regime: "range",
      participantPressureType: "flush-risk",
      skipStage: "context_gate",
      skipReasonCode: "REGIME_LOW_CONFIDENCE",
      macroAction: "pass",
    }));

    saveCandidateSnapshot(
      db,
      {
        candidate: makeCandidate(),
        marketContext: {
          regime: "trend",
          regimeConfidence: 70,
          regimeReasons: [],
          participantBias: "balanced",
          participantPressureType: "squeeze-risk",
          participantConfidence: 68,
          participantRationale: "",
          spotPerpBasis: 0,
          basisDivergence: false,
          liquiditySession: "ny_close",
          summary: "",
          reasonCodes: [],
        },
        alertStatus: "blocked_by_macro",
        createdAt: Date.now(),
      },
      { macroAction: "block", confirmationStatus: "pending" }
    );
    saveCandidateSnapshot(
      db,
      {
        candidate: makeCandidate({ symbol: "ETHUSDT", entryHigh: 3100 }),
        marketContext: {
          regime: "range",
          regimeConfidence: 65,
          regimeReasons: [],
          participantBias: "balanced",
          participantPressureType: "none",
          participantConfidence: 60,
          participantRationale: "",
          spotPerpBasis: 0,
          basisDivergence: true,
          liquiditySession: "ny_close",
          summary: "",
          reasonCodes: [],
        },
        alertStatus: "pending",
        createdAt: Date.now() + 1,
      },
      { macroAction: "downgrade", confirmationStatus: "confirmed" }
    );
  });

  it("按 regime 分组扫描数", () => {
    const rows = getScanBreakdownByRegime(db);
    expect(rows.find((row) => row.label === "trend")?.total).toBeGreaterThan(0);
    expect(rows.find((row) => row.label === "range")?.total).toBeGreaterThan(0);
  });

  it("按 participant pressure 分组扫描数", () => {
    const rows = getScanBreakdownByParticipantPressure(db);
    expect(rows.find((row) => row.label === "squeeze-risk")?.total).toBeGreaterThan(0);
    expect(rows.find((row) => row.label === "flush-risk")?.total).toBeGreaterThan(0);
  });

  it("按 skip stage 分组扫描数", () => {
    const rows = getScanBreakdownBySkipStage(db);
    expect(rows.find((row) => row.label === "context_gate")?.total).toBe(1);
  });

  it("按 macro action 分组候选快照", () => {
    const rows = getCandidateSnapshotBreakdownByMacroAction(db);
    expect(rows.find((row) => row.label === "block")?.total).toBe(1);
    expect(rows.find((row) => row.label === "downgrade")?.total).toBe(1);
  });

  it("按 confirmation status 分组候选快照", () => {
    const rows = getCandidateSnapshotBreakdownByConfirmationStatus(db);
    expect(rows.find((row) => row.label === "pending")?.total).toBe(1);
    expect(rows.find((row) => row.label === "confirmed")?.total).toBe(1);
  });
});

describe("phase 33 risk analytics", () => {
  beforeEach(() => {
    const now = Date.now();

    openPosition(db, makeCandidate(), Date.now(), {
      recommendedPositionSize: 50_000,
      recommendedBaseSize: 0.834,
      riskAmount: 1_000,
      accountRiskPercent: 0.01,
    });
    openPosition(
      db,
      makeCandidate({
        symbol: "ETHUSDT",
        direction: "short",
        entryHigh: 3100,
        entryLow: 3000,
        stopLoss: 3200,
        takeProfit: 2800,
      }),
      Date.now() + 1,
      {
        recommendedPositionSize: 30_000,
        recommendedBaseSize: 9.8,
        riskAmount: 800,
        accountRiskPercent: 0.008,
      }
    );

    const sentSnapshotId = saveCandidateSnapshot(
      db,
      {
        candidate: makeCandidate(),
        marketContext: {
          regime: "trend",
          regimeConfidence: 70,
          regimeReasons: [],
          participantBias: "balanced",
          participantPressureType: "none",
          participantConfidence: 68,
          participantRationale: "",
          spotPerpBasis: 0,
          basisDivergence: false,
          liquiditySession: "london_ny_overlap",
          summary: "",
          reasonCodes: [],
        },
        alertStatus: "pending",
        createdAt: now,
      },
      {
        macroAction: "pass",
        confirmationStatus: "confirmed",
        dailyBias: "bullish",
        orderFlowBias: "bullish",
        positionSizing: {
          status: "available",
          recommendedPositionSize: 50_000,
          recommendedBaseSize: 0.834,
          riskAmount: 1_000,
          accountRiskPercent: 0.01,
          sameDirectionExposureCount: 1,
          sameDirectionExposureRiskPercent: 0.01,
          projectedSameDirectionRiskPercent: 0.02,
          portfolioOpenRiskPercent: 0.018,
          projectedPortfolioRiskPercent: 0.028,
        },
      }
    );
    updateCandidateSnapshotOutcome(db, sentSnapshotId, "sent", {
      alertStatus: "sent",
    });

    saveCandidateSnapshot(
      db,
      {
        candidate: makeCandidate({ symbol: "SOLUSDT", entryHigh: 150, entryLow: 148 }),
        marketContext: {
          regime: "trend",
          regimeConfidence: 70,
          regimeReasons: [],
          participantBias: "balanced",
          participantPressureType: "none",
          participantConfidence: 68,
          participantRationale: "",
          spotPerpBasis: 0,
          basisDivergence: false,
          liquiditySession: "asian_low",
          summary: "",
          reasonCodes: [],
        },
        alertStatus: "blocked_by_macro",
        createdAt: now + 1,
      },
      {
        macroAction: "block",
        confirmationStatus: "pending",
        executionReasonCode: "MACRO_BLOCKED",
        dailyBias: "bearish",
        orderFlowBias: "bearish",
        positionSizing: {
          status: "unavailable",
          reason: "account_size_missing",
          accountRiskPercent: 0.01,
          sameDirectionExposureCount: 1,
          sameDirectionExposureRiskPercent: 0.01,
          projectedSameDirectionRiskPercent: 0.02,
          portfolioOpenRiskPercent: 0.018,
          projectedPortfolioRiskPercent: 0.028,
        },
      }
    );
    saveCandidateSnapshot(
      db,
      {
        candidate: makeCandidate({ symbol: "XRPUSDT", entryHigh: 2.5, entryLow: 2.4 }),
        marketContext: {
          regime: "range",
          regimeConfidence: 60,
          regimeReasons: [],
          participantBias: "balanced",
          participantPressureType: "none",
          participantConfidence: 60,
          participantRationale: "",
          spotPerpBasis: 0,
          basisDivergence: false,
          liquiditySession: "asian_low",
          summary: "",
          reasonCodes: [],
        },
        alertStatus: "pending",
        createdAt: now + 2,
      },
      {
        macroAction: "pass",
        confirmationStatus: "confirmed",
        executionOutcome: "skipped_execution_gate",
        executionReasonCode: "PORTFOLIO_RISK_LIMIT",
        dailyBias: "neutral",
        orderFlowBias: "bearish",
        positionSizing: {
          status: "available",
          recommendedPositionSize: 10_000,
          recommendedBaseSize: 4_000,
          riskAmount: 500,
          accountRiskPercent: 0.005,
          sameDirectionExposureCount: 2,
          sameDirectionExposureRiskPercent: 0.02,
          projectedSameDirectionRiskPercent: 0.025,
          portfolioOpenRiskPercent: 0.028,
          projectedPortfolioRiskPercent: 0.033,
        },
      }
    );

    const closedSnapshotId = saveCandidateSnapshot(
      db,
      {
        candidate: makeCandidate({
          symbol: "ADAUSDT",
          entryHigh: 1.1,
          entryLow: 1.0,
          stopLoss: 0.9,
          takeProfit: 1.4,
        }),
        marketContext: {
          regime: "range",
          regimeConfidence: 65,
          regimeReasons: [],
          participantBias: "balanced",
          participantPressureType: "squeeze-risk",
          participantConfidence: 62,
          participantRationale: "",
          spotPerpBasis: 0,
          basisDivergence: false,
          liquiditySession: "london_ramp",
          summary: "",
          reasonCodes: [],
        },
        alertStatus: "pending",
        createdAt: now - 10 * 24 * 60 * 60 * 1000,
      },
      {
        macroAction: "downgrade",
        confirmationStatus: "confirmed",
        dailyBias: "bearish",
        orderFlowBias: "bullish",
        positionSizing: {
          status: "available",
          recommendedPositionSize: 20_000,
          recommendedBaseSize: 19_047,
          riskAmount: 600,
          accountRiskPercent: 0.006,
          sameDirectionExposureCount: 0,
          sameDirectionExposureRiskPercent: 0,
          projectedSameDirectionRiskPercent: 0.006,
          portfolioOpenRiskPercent: 0.018,
          projectedPortfolioRiskPercent: 0.024,
        },
      }
    );
    updateCandidateSnapshotOutcome(db, closedSnapshotId, "sent", {
      alertStatus: "sent",
    });
    openPosition(
      db,
      makeCandidate({
        symbol: "ADAUSDT",
        entryHigh: 1.1,
        entryLow: 1.0,
        stopLoss: 0.9,
        takeProfit: 1.4,
      }),
      now - 10 * 24 * 60 * 60 * 1000,
      {
        recommendedPositionSize: 20_000,
        recommendedBaseSize: 19_047,
        riskAmount: 600,
        accountRiskPercent: 0.006,
      }
    );
    closePosition(db, "ADAUSDT", "long", "4h", 1.1, 1.4, "closed_tp");
  });

  it("返回仓位建议覆盖率和平均风险", () => {
    const stats = getPositionSizingStats(db);
    expect(stats.totalSnapshots).toBe(4);
    expect(stats.sizedSnapshots).toBe(3);
    expect(stats.unavailableSnapshots).toBe(1);
    expect(stats.sizingCoverage).toBeCloseTo(0.75, 5);
    expect(stats.avgRiskAmount).toBeCloseTo(700, 5);
    expect(stats.avgProjectedPortfolioRiskPercent).toBeCloseTo(0.02825, 5);
  });

  it("按方向汇总当前 open risk", () => {
    const rows = getOpenExposureByDirection(db);
    expect(rows.find((row) => row.label === "long")?.openRiskAmount).toBe(1_000);
    expect(rows.find((row) => row.label === "short")?.openRiskPercent).toBeCloseTo(0.008, 5);
  });

  it("返回最近风险快照", () => {
    const rows = getRecentRiskSnapshots(db, 2);
    expect(rows).toHaveLength(2);
    expect(rows[0].symbol).toBe("XRPUSDT");
    expect(rows[0].executionOutcome).toBe("skipped_execution_gate");
    expect(rows[1].symbol).toBe("SOLUSDT");
  });

  it("返回执行漏斗统计", () => {
    const stats = getExecutionFunnelStats(db);
    expect(stats.totalSnapshots).toBe(4);
    expect(stats.blockedByMacro).toBe(1);
    expect(stats.skippedExecutionGate).toBe(1);
    expect(stats.sent).toBe(2);
    expect(stats.opened).toBe(2);
    expect(stats.openPositions).toBe(1);
    expect(stats.closedPositions).toBe(1);
  });

  it("按执行结果和执行原因分组快照", () => {
    const outcomeRows = getCandidateSnapshotBreakdownByExecutionOutcome(db);
    const reasonRows = getCandidateSnapshotBreakdownByExecutionReason(db);

    expect(outcomeRows.find((row) => row.label === "blocked_by_macro")?.total).toBe(1);
    expect(outcomeRows.find((row) => row.label === "skipped_execution_gate")?.total).toBe(1);
    expect(outcomeRows.find((row) => row.label === "sent")?.total).toBe(2);
    expect(reasonRows.find((row) => row.label === "PORTFOLIO_RISK_LIMIT")?.total).toBe(1);
    expect(reasonRows.find((row) => row.label === "MACRO_BLOCKED")?.total).toBe(1);
  });

  it("按 regime / participant / macro action 返回执行漏斗交叉分桶", () => {
    const regimeRows = getExecutionBreakdownByRegime(db);
    const participantRows = getExecutionBreakdownByParticipantPressure(db);
    const macroRows = getExecutionBreakdownByMacroAction(db);

    expect(regimeRows.find((row) => row.label === "trend")).toMatchObject({
      totalSnapshots: 2,
      blockedByMacro: 1,
      sent: 1,
      opened: 1,
    });
    expect(regimeRows.find((row) => row.label === "range")).toMatchObject({
      totalSnapshots: 2,
      skippedExecutionGate: 1,
    });

    expect(participantRows.find((row) => row.label === "none")).toMatchObject({
      totalSnapshots: 3,
      blockedByMacro: 1,
      skippedExecutionGate: 1,
      sent: 1,
    });

    expect(macroRows.find((row) => row.label === "pass")).toMatchObject({
      totalSnapshots: 2,
      skippedExecutionGate: 1,
      sent: 1,
      opened: 1,
    });
    expect(macroRows.find((row) => row.label === "block")).toMatchObject({
      totalSnapshots: 1,
      blockedByMacro: 1,
    });
    expect(macroRows.find((row) => row.label === "downgrade")).toMatchObject({
      totalSnapshots: 1,
      sent: 1,
      opened: 1,
    });
  });

  it("按 regime / participant / macro action 返回 sent 后真实结果分桶", () => {
    const regimeRows = getOutcomeBreakdownByRegime(db);
    const participantRows = getOutcomeBreakdownByParticipantPressure(db);
    const macroRows = getOutcomeBreakdownByMacroAction(db);

    expect(regimeRows.find((row) => row.label === "trend")).toMatchObject({
      sent: 1,
      openPositions: 1,
      closedTrades: 0,
      wins: 0,
      decisiveClosedTrades: 0,
      sampleAdequate: false,
      sampleWarning: "no_decisive_closed_trades",
    });
    expect(regimeRows.find((row) => row.label === "range")).toMatchObject({
      sent: 1,
      openPositions: 0,
      closedTrades: 1,
      wins: 1,
      losses: 0,
      decisiveClosedTrades: 1,
      winRate: 1,
      sampleAdequate: false,
      sampleWarning: "low_sample",
    });

    expect(participantRows.find((row) => row.label === "none")).toMatchObject({
      sent: 1,
      openPositions: 1,
    });
    expect(participantRows.find((row) => row.label === "squeeze-risk")).toMatchObject({
      sent: 1,
      closedTrades: 1,
      wins: 1,
    });

    expect(macroRows.find((row) => row.label === "pass")).toMatchObject({
      sent: 1,
      openPositions: 1,
    });
    expect(macroRows.find((row) => row.label === "downgrade")).toMatchObject({
      sent: 1,
      closedTrades: 1,
      wins: 1,
      decisiveClosedTrades: 1,
      sampleAdequate: false,
      sampleWarning: "low_sample",
    });
    expect(macroRows.find((row) => row.label === "downgrade")?.avgPnlR).toBeCloseTo(
      2.3333333333333335,
      10
    );
    expect(macroRows.find((row) => row.label === "downgrade")?.totalR).toBeCloseTo(
      2.3333333333333335,
      10
    );
  });

  it("按 dailyBias / orderFlowBias / liquiditySession 返回 sent 后真实结果分桶", () => {
    const dailyBiasRows = getOutcomeBreakdownByDailyBias(db);
    const orderFlowRows = getOutcomeBreakdownByOrderFlowBias(db);
    const sessionRows = getOutcomeBreakdownByLiquiditySession(db);

    expect(dailyBiasRows.find((row) => row.label === "bullish")).toMatchObject({
      sent: 1,
      openPositions: 1,
    });
    expect(dailyBiasRows.find((row) => row.label === "bearish")).toMatchObject({
      sent: 1,
      closedTrades: 1,
      wins: 1,
    });

    expect(orderFlowRows.find((row) => row.label === "bullish")).toMatchObject({
      sent: 2,
      wins: 1,
    });
    expect(orderFlowRows.find((row) => row.label === "bearish")).toMatchObject({
      sent: 0,
      closedTrades: 0,
    });

    expect(sessionRows.find((row) => row.label === "london_ny_overlap")).toMatchObject({
      sent: 1,
      openPositions: 1,
    });
    expect(sessionRows.find((row) => row.label === "london_ramp")).toMatchObject({
      sent: 1,
      closedTrades: 1,
      wins: 1,
    });
  });

  it("返回 all-time 和 last 7d 的结果窗口汇总", () => {
    const rows = getOutcomeWindowRows(db, Date.now());
    expect(rows[0]).toMatchObject({
      label: "All-time",
      sent: 2,
      opened: 2,
      closedTrades: 1,
      decisiveClosedTrades: 1,
      wins: 1,
      losses: 0,
      sampleAdequate: false,
      sampleWarning: "low_sample",
    });
    expect(rows[1]).toMatchObject({
      label: "Last 7d",
      sent: 1,
      opened: 1,
      closedTrades: 0,
      decisiveClosedTrades: 0,
      wins: 0,
      losses: 0,
      sampleAdequate: false,
      sampleWarning: "no_decisive_closed_trades",
    });
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initDb } from "../../../src/services/persistence/init-db.js";
import {
  saveCandidate,
  saveCandidateSnapshot,
  loadCandidateSnapshots,
  countCandidateSnapshotsByStatus,
  updateCandidateSnapshotOutcome,
  updateAlertStatus,
  buildId,
} from "../../../src/services/persistence/save-candidate.js";
import { loadRecentCandidates, findCandidate } from "../../../src/services/persistence/load-candidates.js";
import type { AlertPayload } from "../../../src/domain/signal/alert-payload.js";
import type { TradeCandidate } from "../../../src/domain/signal/trade-candidate.js";
import type { MarketContext } from "../../../src/domain/market/market-context.js";

// ── テスト夹具 ────────────────────────────────────────────────────────────────

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
    structureReason: "FVG + 流动性扫描",
    contextReason: "趋势市场",
    reasonCodes: ["STRUCTURE_CONFLUENCE_BOOST"],
    ...overrides,
  };
}

function makeCtx(): MarketContext {
  return {
    regime: "trend",
    regimeConfidence: 75,
    regimeReasons: [],
    participantBias: "balanced",
    participantPressureType: "none",
    participantConfidence: 70,
    participantRationale: "",
    spotPerpBasis: 0,
    basisDivergence: false,
    liquiditySession: "london_ramp",
    summary: "テスト",
    reasonCodes: [],
  };
}

function makePayload(overrides: Partial<TradeCandidate> = {}): AlertPayload {
  return {
    candidate: makeCandidate(overrides),
    marketContext: makeCtx(),
    alertStatus: "pending",
    createdAt: Date.now(),
  };
}

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  initDb(db);
});

// ── initDb ────────────────────────────────────────────────────────────────────

describe("initDb", () => {
  it("candidates テーブルが作成される", () => {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='candidates'").get();
    expect(row).toBeDefined();
  });

  it("二回呼んでもエラーにならない（IF NOT EXISTS）", () => {
    expect(() => initDb(db)).not.toThrow();
  });
});

// ── buildId ───────────────────────────────────────────────────────────────────

describe("buildId", () => {
  it("symbol_direction_timeframe_floor(entryHigh) の形式", () => {
    expect(buildId("BTCUSDT", "long", "4h", 60000.99)).toBe("BTCUSDT_long_4h_60000");
  });

  it("entryHigh が整数の場合そのまま", () => {
    expect(buildId("ETHUSDT", "short", "1h", 3000)).toBe("ETHUSDT_short_1h_3000");
  });
});

// ── saveCandidate ─────────────────────────────────────────────────────────────

describe("saveCandidate — 基本保存", () => {
  it("レコードが 1 件挿入される", () => {
    saveCandidate(db, makePayload());
    const count = db.prepare("SELECT COUNT(*) as n FROM candidates").get() as { n: number };
    expect(count.n).toBe(1);
  });

  it("symbol が正しく保存される", () => {
    saveCandidate(db, makePayload());
    const row = db.prepare("SELECT symbol FROM candidates").get() as { symbol: string };
    expect(row.symbol).toBe("BTCUSDT");
  });

  it("direction が正しく保存される", () => {
    saveCandidate(db, makePayload());
    const row = db.prepare("SELECT direction FROM candidates").get() as { direction: string };
    expect(row.direction).toBe("long");
  });

  it("reasonCodes が JSON として保存される", () => {
    saveCandidate(db, makePayload());
    const row = db.prepare("SELECT reason_codes FROM candidates").get() as { reason_codes: string };
    expect(JSON.parse(row.reason_codes)).toContain("STRUCTURE_CONFLUENCE_BOOST");
  });

  it("regimeAligned=true → INTEGER 1", () => {
    saveCandidate(db, makePayload());
    const row = db.prepare("SELECT regime_aligned FROM candidates").get() as { regime_aligned: number };
    expect(row.regime_aligned).toBe(1);
  });

  it("regimeAligned=false → INTEGER 0", () => {
    saveCandidate(db, makePayload({ regimeAligned: false }));
    const row = db.prepare("SELECT regime_aligned FROM candidates").get() as { regime_aligned: number };
    expect(row.regime_aligned).toBe(0);
  });

  it("macroReason=undefined → NULL", () => {
    saveCandidate(db, makePayload());
    const row = db.prepare("SELECT macro_reason FROM candidates").get() as { macro_reason: string | null };
    expect(row.macro_reason).toBeNull();
  });

  it("macroReason が指定された場合は保存される", () => {
    saveCandidate(db, makePayload({ macroReason: "Fed pivot" }));
    const row = db.prepare("SELECT macro_reason FROM candidates").get() as { macro_reason: string | null };
    expect(row.macro_reason).toBe("Fed pivot");
  });

  it("持久化元数据会写入 candidates", () => {
    saveCandidate(db, makePayload(), {
      macroAction: "downgrade",
      confirmationStatus: "pending",
      dailyBias: "bullish",
      orderFlowBias: "bearish",
      positionSizing: {
        status: "available",
        recommendedPositionSize: 50_000,
        recommendedBaseSize: 0.834,
        riskAmount: 1_000,
        accountRiskPercent: 0.01,
        sameDirectionExposureCount: 1,
        sameDirectionExposureRiskPercent: 0.01,
        projectedSameDirectionRiskPercent: 0.02,
        portfolioOpenRiskPercent: 0.02,
        projectedPortfolioRiskPercent: 0.03,
      },
    });
    const row = db.prepare(`
      SELECT macro_action, confirmation_status, daily_bias, order_flow_bias, regime, participant_pressure_type,
             liquidity_session, recommended_position_size, risk_amount, account_risk_percent, same_direction_exposure_count
      FROM candidates
    `).get() as {
      macro_action: string;
      confirmation_status: string;
      daily_bias: string;
      order_flow_bias: string;
      regime: string;
      participant_pressure_type: string;
      liquidity_session: string;
      recommended_position_size: number;
      risk_amount: number;
      account_risk_percent: number;
      same_direction_exposure_count: number;
    };
    expect(row.macro_action).toBe("downgrade");
    expect(row.confirmation_status).toBe("pending");
    expect(row.daily_bias).toBe("bullish");
    expect(row.order_flow_bias).toBe("bearish");
    expect(row.regime).toBe("trend");
    expect(row.participant_pressure_type).toBe("none");
    expect(row.liquidity_session).toBe("london_ramp");
    expect(row.recommended_position_size).toBe(50_000);
    expect(row.risk_amount).toBe(1_000);
    expect(row.account_risk_percent).toBeCloseTo(0.01, 5);
    expect(row.same_direction_exposure_count).toBe(1);
  });
});

describe("candidate_snapshots", () => {
  it("blocked_by_macro 样本会被保留", () => {
    saveCandidateSnapshot(
      db,
      { ...makePayload(), alertStatus: "blocked_by_macro" },
      { macroAction: "block", confirmationStatus: "confirmed" }
    );
    expect(countCandidateSnapshotsByStatus(db, "blocked_by_macro")).toBe(1);
  });

  it("snapshot 可按最新顺序读取", () => {
    const now = Date.now();
    saveCandidateSnapshot(db, { ...makePayload({ symbol: "BTCUSDT" }), createdAt: now - 2000 });
    saveCandidateSnapshot(db, { ...makePayload({ symbol: "ETHUSDT" }), createdAt: now - 1000 });
    const rows = loadCandidateSnapshots(db, 10);
    expect(rows[0].symbol).toBe("ETHUSDT");
    expect(rows[1].symbol).toBe("BTCUSDT");
  });

  it("重复评估同一价格位会生成不同 candidateId，并保留同一 baseCandidateId", () => {
    const createdAtA = Date.now() - 2000;
    const createdAtB = Date.now() - 1000;
    saveCandidateSnapshot(db, { ...makePayload(), createdAt: createdAtA });
    saveCandidateSnapshot(db, { ...makePayload(), createdAt: createdAtB });

    const rows = loadCandidateSnapshots(db, 10);
    expect(rows).toHaveLength(2);
    expect(rows[0].candidateId).not.toBe(rows[1].candidateId);
    expect(rows[0].baseCandidateId).toBe(rows[1].baseCandidateId);
  });

  it("snapshot 会记录最终执行结果", () => {
    const createdAt = Date.now();
    const candidateId = saveCandidateSnapshot(
      db,
      { ...makePayload(), createdAt },
      { executionOutcome: "pending" }
    );

    updateCandidateSnapshotOutcome(db, candidateId, "sent", {
      alertStatus: "sent",
    });

    const row = loadCandidateSnapshots(db, 1)[0];
    expect(row.alertStatus).toBe("sent");
    expect(row.executionOutcome).toBe("sent");
    expect(row.executionReasonCode).toBeNull();
  });

  it("snapshot 跳过结果会同步更新 alertStatus", () => {
    const createdAt = Date.now();
    const candidateId = saveCandidateSnapshot(
      db,
      { ...makePayload(), createdAt },
      { executionOutcome: "pending" }
    );

    updateCandidateSnapshotOutcome(db, candidateId, "skipped_duplicate", {
      executionReasonCode: "already_sent",
    });

    const row = loadCandidateSnapshots(db, 1)[0];
    expect(row.alertStatus).toBe("skipped_duplicate");
    expect(row.executionOutcome).toBe("skipped_duplicate");
    expect(row.executionReasonCode).toBe("already_sent");
    expect(countCandidateSnapshotsByStatus(db, "skipped_duplicate")).toBe(1);
  });
});

describe("saveCandidate — 重複上書き（INSERT OR REPLACE）", () => {
  it("同じ ID で 2 回保存 → レコード数は 1 のまま", () => {
    saveCandidate(db, makePayload());
    saveCandidate(db, makePayload({ signalGrade: "standard" }));
    const count = db.prepare("SELECT COUNT(*) as n FROM candidates").get() as { n: number };
    expect(count.n).toBe(1);
  });

  it("上書き後は新しい signalGrade が反映される", () => {
    saveCandidate(db, makePayload({ signalGrade: "high-conviction" }));
    saveCandidate(db, makePayload({ signalGrade: "standard" }));
    const row = db.prepare("SELECT signal_grade FROM candidates").get() as { signal_grade: string };
    expect(row.signal_grade).toBe("standard");
  });

  it("異なる symbol → 別レコードが作られる", () => {
    saveCandidate(db, makePayload({ symbol: "BTCUSDT" }));
    saveCandidate(db, makePayload({ symbol: "ETHUSDT" }));
    const count = db.prepare("SELECT COUNT(*) as n FROM candidates").get() as { n: number };
    expect(count.n).toBe(2);
  });
});

// ── updateAlertStatus ─────────────────────────────────────────────────────────

describe("updateAlertStatus", () => {
  it("pending → sent に更新できる", () => {
    saveCandidate(db, makePayload());
    updateAlertStatus(db, "BTCUSDT", "long", "4h", 60000, "sent");
    const row = db.prepare("SELECT alert_status FROM candidates").get() as { alert_status: string };
    expect(row.alert_status).toBe("sent");
  });

  it("pending → failed に更新できる", () => {
    saveCandidate(db, makePayload());
    updateAlertStatus(db, "BTCUSDT", "long", "4h", 60000, "failed");
    const row = db.prepare("SELECT alert_status FROM candidates").get() as { alert_status: string };
    expect(row.alert_status).toBe("failed");
  });

  it("存在しない ID → エラーにならない（0 行更新）", () => {
    expect(() => updateAlertStatus(db, "XYZUSDT", "long", "4h", 99999, "sent")).not.toThrow();
  });
});

// ── loadRecentCandidates ──────────────────────────────────────────────────────

describe("loadRecentCandidates", () => {
  it("保存したレコードが読み込める", () => {
    saveCandidate(db, makePayload());
    const results = loadRecentCandidates(db, 24);
    expect(results).toHaveLength(1);
  });

  it("読み込んだ候補の symbol が一致する", () => {
    saveCandidate(db, makePayload({ symbol: "ETHUSDT" }));
    const results = loadRecentCandidates(db, 24);
    expect(results[0].candidate.symbol).toBe("ETHUSDT");
  });

  it("regimeAligned が boolean として復元される", () => {
    saveCandidate(db, makePayload({ regimeAligned: false }));
    const results = loadRecentCandidates(db, 24);
    expect(results[0].candidate.regimeAligned).toBe(false);
  });

  it("reasonCodes が配列として復元される", () => {
    saveCandidate(db, makePayload());
    const results = loadRecentCandidates(db, 24);
    expect(results[0].candidate.reasonCodes).toContain("STRUCTURE_CONFLUENCE_BOOST");
  });

  it("limitHours=0 → 空配列（過去 0 秒より前のレコードは返さない）", async () => {
    saveCandidate(db, makePayload());
    // 少し待って 0h 制限で検索 → created_at が今より前なので空になる
    const pastPayload: AlertPayload = {
      ...makePayload(),
      createdAt: Date.now() - 5000, // 5 秒前
    };
    const freshDb = new Database(":memory:");
    initDb(freshDb);
    saveCandidate(freshDb, pastPayload);
    const results = loadRecentCandidates(freshDb, 0);
    expect(results).toHaveLength(0);
  });

  it("複数レコード → 新しい順（DESC）で返る", () => {
    const now = Date.now();
    saveCandidate(db, { ...makePayload(), createdAt: now - 2000 });
    saveCandidate(db, { ...makePayload({ symbol: "ETHUSDT" }), createdAt: now - 1000 });
    const results = loadRecentCandidates(db, 24);
    expect(results[0].candidate.symbol).toBe("ETHUSDT"); // 新しい方が先
  });

  it("liquiditySession が復元される", () => {
    saveCandidate(db, makePayload());
    const results = loadRecentCandidates(db, 24);
    expect(results[0].marketContext.liquiditySession).toBe("london_ramp");
  });
});

// ── findCandidate ─────────────────────────────────────────────────────────────

describe("findCandidate", () => {
  it("存在する候補が取得できる", () => {
    saveCandidate(db, makePayload());
    const result = findCandidate(db, "BTCUSDT", "long", "4h", 60000);
    expect(result).toBeDefined();
    expect(result?.candidate.symbol).toBe("BTCUSDT");
  });

  it("存在しない候補 → undefined", () => {
    const result = findCandidate(db, "XYZUSDT", "long", "4h", 60000);
    expect(result).toBeUndefined();
  });

  it("alertStatus が正しく復元される", () => {
    saveCandidate(db, makePayload());
    updateAlertStatus(db, "BTCUSDT", "long", "4h", 60000, "sent");
    const result = findCandidate(db, "BTCUSDT", "long", "4h", 60000);
    expect(result?.alertStatus).toBe("sent");
  });
});

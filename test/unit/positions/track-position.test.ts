import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initPositionsDb } from "../../../src/services/positions/init-positions-db.js";
import {
  openPosition,
  closePosition,
  getOpenPositions,
  countOpenByDirection,
  getOpenRiskSummary,
  findPosition,
  buildPositionId,
} from "../../../src/services/positions/track-position.js";
import type { TradeCandidate } from "../../../src/domain/signal/trade-candidate.js";

// ── テスト夾具 ────────────────────────────────────────────────────────────

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
  db = new Database(":memory:");
  initPositionsDb(db);
});

// ── buildPositionId ──────────────────────────────────────────────────────

describe("buildPositionId", () => {
  it("symbol_direction_timeframe_floor(entryHigh) の形式", () => {
    expect(buildPositionId("BTCUSDT", "long", "4h", 60000.99)).toBe(
      "BTCUSDT_long_4h_60000"
    );
  });

  it("entryHigh が整数の場合そのまま", () => {
    expect(buildPositionId("ETHUSDT", "short", "1h", 3000)).toBe(
      "ETHUSDT_short_1h_3000"
    );
  });
});

// ── initPositionsDb ─────────────────────────────────────────────────────

describe("initPositionsDb", () => {
  it("positions テーブルが作成される", () => {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='positions'")
      .get();
    expect(row).toBeDefined();
  });

  it("二回呼んでもエラーにならない（IF NOT EXISTS）", () => {
    expect(() => initPositionsDb(db)).not.toThrow();
  });
});

// ── openPosition ─────────────────────────────────────────────────────────

describe("openPosition — 基本開仓", () => {
  it("レコードが 1 件挿入される", () => {
    openPosition(db, makeCandidate());
    const count = db
      .prepare("SELECT COUNT(*) as n FROM positions")
      .get() as { n: number };
    expect(count.n).toBe(1);
  });

  it("status='open' で挿入される", () => {
    openPosition(db, makeCandidate());
    const row = db
      .prepare("SELECT status FROM positions")
      .get() as { status: string };
    expect(row.status).toBe("open");
  });

  it("symbol / direction / timeframe が正しく保存される", () => {
    openPosition(db, makeCandidate());
    const row = db
      .prepare("SELECT symbol, direction, timeframe FROM positions")
      .get() as { symbol: string; direction: string; timeframe: string };
    expect(row.symbol).toBe("BTCUSDT");
    expect(row.direction).toBe("long");
    expect(row.timeframe).toBe("4h");
  });

  it("signalGrade が正しく保存される", () => {
    openPosition(db, makeCandidate({ signalGrade: "standard" }));
    const row = db
      .prepare("SELECT signal_grade FROM positions")
      .get() as { signal_grade: string };
    expect(row.signal_grade).toBe("standard");
  });

  it("同一 ID で 2 回 open → INSERT OR IGNORE でレコード数は 1 のまま", () => {
    openPosition(db, makeCandidate());
    openPosition(db, makeCandidate({ signalGrade: "standard" })); // 同一ID
    const count = db
      .prepare("SELECT COUNT(*) as n FROM positions")
      .get() as { n: number };
    expect(count.n).toBe(1);
  });

  it("openedAt が保存される", () => {
    const ts = Date.now();
    openPosition(db, makeCandidate(), ts);
    const row = db
      .prepare("SELECT opened_at FROM positions")
      .get() as { opened_at: number };
    expect(row.opened_at).toBe(ts);
  });

  it("风险元数据会写入 positions", () => {
    openPosition(db, makeCandidate(), Date.now(), {
      recommendedPositionSize: 50_000,
      recommendedBaseSize: 0.834,
      riskAmount: 1_000,
      accountRiskPercent: 0.01,
    });
    const row = db.prepare(`
      SELECT recommended_position_size, recommended_base_size, risk_amount, account_risk_percent
      FROM positions
    `).get() as {
      recommended_position_size: number;
      recommended_base_size: number;
      risk_amount: number;
      account_risk_percent: number;
    };
    expect(row.recommended_position_size).toBe(50_000);
    expect(row.recommended_base_size).toBeCloseTo(0.834, 3);
    expect(row.risk_amount).toBe(1_000);
    expect(row.account_risk_percent).toBeCloseTo(0.01, 5);
  });
});

// ── closePosition ────────────────────────────────────────────────────────

describe("closePosition — 止盈", () => {
  it("status が closed_tp に更新される", () => {
    openPosition(db, makeCandidate());
    closePosition(db, "BTCUSDT", "long", "4h", 60000, 63000, "closed_tp");
    const row = db
      .prepare("SELECT status FROM positions")
      .get() as { status: string };
    expect(row.status).toBe("closed_tp");
  });

  it("close_price が保存される", () => {
    openPosition(db, makeCandidate());
    closePosition(db, "BTCUSDT", "long", "4h", 60000, 63000, "closed_tp");
    const row = db
      .prepare("SELECT close_price FROM positions")
      .get() as { close_price: number };
    expect(row.close_price).toBe(63000);
  });

  it("long 止盈: pnlR が正の値", () => {
    // entryLow=59800, entryHigh=60000 → entryMid=59900
    // stopLoss=58800 → risk=59900-58800=1100
    // closePrice=63000 → gain=63000-59900=3100
    // pnlR = 3100/1100 ≈ 2.818
    openPosition(db, makeCandidate());
    closePosition(db, "BTCUSDT", "long", "4h", 60000, 63000, "closed_tp");
    const row = db
      .prepare("SELECT pnl_r FROM positions")
      .get() as { pnl_r: number };
    expect(row.pnl_r).toBeGreaterThan(0);
    expect(row.pnl_r).toBeCloseTo(2.818, 2);
  });

  it("long 止损: pnlR が負の値", () => {
    openPosition(db, makeCandidate());
    closePosition(db, "BTCUSDT", "long", "4h", 60000, 58800, "closed_sl");
    const row = db
      .prepare("SELECT pnl_r FROM positions")
      .get() as { pnl_r: number };
    expect(row.pnl_r).toBeLessThan(0);
    expect(row.pnl_r).toBeCloseTo(-1.0, 1); // 止損地点でほぼ -1R
  });

  it("short 止盈: pnlR が正の値", () => {
    // short: entryLow=3000, entryHigh=3100 → entryMid=3050
    // stopLoss=3200 → risk=3200-3050=150
    // closePrice=2800 → gain=3050-2800=250
    // pnlR = 250/150 ≈ 1.667
    openPosition(
      db,
      makeCandidate({
        symbol: "ETHUSDT",
        direction: "short",
        entryLow: 3000,
        entryHigh: 3100,
        stopLoss: 3200,
        takeProfit: 2800,
      })
    );
    closePosition(db, "ETHUSDT", "short", "4h", 3100, 2800, "closed_tp");
    const row = db
      .prepare("SELECT pnl_r FROM positions")
      .get() as { pnl_r: number };
    expect(row.pnl_r).toBeGreaterThan(0);
    expect(row.pnl_r).toBeCloseTo(1.667, 2);
  });
});

describe("closePosition — エッジケース", () => {
  it("存在しない ID → エラーにならない（0 行更新）", () => {
    expect(() =>
      closePosition(db, "XYZUSDT", "long", "4h", 99999, 100000, "closed_tp")
    ).not.toThrow();
  });

  it("手動平仓: status が closed_manual になる", () => {
    openPosition(db, makeCandidate());
    closePosition(db, "BTCUSDT", "long", "4h", 60000, 61000, "closed_manual");
    const row = db
      .prepare("SELECT status FROM positions")
      .get() as { status: string };
    expect(row.status).toBe("closed_manual");
  });
});

// ── getOpenPositions ─────────────────────────────────────────────────────

describe("getOpenPositions", () => {
  it("open 仓位が返る", () => {
    openPosition(db, makeCandidate());
    const positions = getOpenPositions(db);
    expect(positions).toHaveLength(1);
    expect(positions[0].symbol).toBe("BTCUSDT");
  });

  it("closed 仓位は含まれない", () => {
    openPosition(db, makeCandidate());
    closePosition(db, "BTCUSDT", "long", "4h", 60000, 63000, "closed_tp");
    const positions = getOpenPositions(db);
    expect(positions).toHaveLength(0);
  });

  it("複数 open 仓位が全て返る", () => {
    openPosition(db, makeCandidate({ symbol: "BTCUSDT" }));
    openPosition(db, makeCandidate({ symbol: "ETHUSDT", entryHigh: 3100 }));
    const positions = getOpenPositions(db);
    expect(positions).toHaveLength(2);
  });

  it("regimeAligned は保存していない（domain 簡略化）→ status が正しく復元される", () => {
    openPosition(db, makeCandidate());
    const positions = getOpenPositions(db);
    expect(positions[0].status).toBe("open");
  });
});

// ── countOpenByDirection ─────────────────────────────────────────────────

describe("countOpenByDirection", () => {
  it("long 仓位なし → 0", () => {
    expect(countOpenByDirection(db, "long")).toBe(0);
  });

  it("long 1 件 → 1", () => {
    openPosition(db, makeCandidate({ direction: "long" }));
    expect(countOpenByDirection(db, "long")).toBe(1);
  });

  it("long 2 件 → 2", () => {
    openPosition(db, makeCandidate({ symbol: "BTCUSDT", direction: "long" }));
    openPosition(db, makeCandidate({ symbol: "ETHUSDT", direction: "long", entryHigh: 3100 }));
    expect(countOpenByDirection(db, "long")).toBe(2);
  });

  it("short の count が long の count に影響しない", () => {
    openPosition(db, makeCandidate({ direction: "short" }));
    expect(countOpenByDirection(db, "long")).toBe(0);
    expect(countOpenByDirection(db, "short")).toBe(1);
  });

  it("closed_tp の仓位はカウントされない", () => {
    openPosition(db, makeCandidate());
    closePosition(db, "BTCUSDT", "long", "4h", 60000, 63000, "closed_tp");
    expect(countOpenByDirection(db, "long")).toBe(0);
  });
});

describe("getOpenRiskSummary", () => {
  it("会汇总 open 仓位的风险金额与风险百分比", () => {
    openPosition(db, makeCandidate(), Date.now(), {
      riskAmount: 1_000,
      accountRiskPercent: 0.01,
    });
    openPosition(
      db,
      makeCandidate({ symbol: "ETHUSDT", entryHigh: 3100 }),
      Date.now(),
      {
        riskAmount: 1_500,
        accountRiskPercent: 0.015,
      }
    );
    const summary = getOpenRiskSummary(db);
    expect(summary.openCount).toBe(2);
    expect(summary.openRiskAmount).toBe(2_500);
    expect(summary.openRiskPercent).toBeCloseTo(0.025, 5);
  });

  it("缺失风险百分比时不会用当前配置回填旧仓位风险", () => {
    openPosition(db, makeCandidate());
    const summary = getOpenRiskSummary(db, "long");
    expect(summary.openCount).toBe(1);
    expect(summary.openRiskPercent).toBe(0);
  });
});

// ── findPosition ─────────────────────────────────────────────────────────

describe("findPosition", () => {
  it("存在する仓位が取得できる", () => {
    openPosition(db, makeCandidate());
    const pos = findPosition(db, "BTCUSDT", "long", "4h", 60000);
    expect(pos).toBeDefined();
    expect(pos?.symbol).toBe("BTCUSDT");
  });

  it("存在しない仓位 → undefined", () => {
    const pos = findPosition(db, "XYZUSDT", "long", "4h", 99999);
    expect(pos).toBeUndefined();
  });

  it("平仓後の仓位も取得できる（status と pnlR が正しい）", () => {
    openPosition(db, makeCandidate());
    closePosition(db, "BTCUSDT", "long", "4h", 60000, 63000, "closed_tp");
    const pos = findPosition(db, "BTCUSDT", "long", "4h", 60000);
    expect(pos?.status).toBe("closed_tp");
    expect(pos?.pnlR).toBeGreaterThan(0);
    expect(pos?.closePrice).toBe(63000);
  });
});

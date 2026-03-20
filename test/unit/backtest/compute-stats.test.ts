import { describe, it, expect } from "vitest";
import {
  computeStats,
  computeMaxDrawdown,
  computeSharpe,
} from "../../../src/services/backtest/compute-stats.js";
import type { BacktestTrade } from "../../../src/domain/backtest/backtest-types.js";

// ── テスト夾具 ────────────────────────────────────────────────────────────

const BASE_SIGNAL = {
  candleIndex: 0,
  direction: "long" as const,
  entryHigh: 60000,
  entryLow: 59800,
  stopLoss: 58800,
  takeProfit: 63000,
  structureScore: 75,
  structureReason: "FVG",
};

function makeTrade(
  status: BacktestTrade["status"],
  pnlR: number
): BacktestTrade {
  return {
    signal: BASE_SIGNAL,
    entryPrice: 60000,
    exitPrice: 60000,
    exitCandleIndex: 5,
    status,
    pnlR,
  };
}

// ── computeMaxDrawdown ────────────────────────────────────────────────────

describe("computeMaxDrawdown", () => {
  it("空配列 → 0", () => {
    expect(computeMaxDrawdown([])).toBe(0);
  });

  it("すべて勝ち → ドローダウンなし", () => {
    expect(computeMaxDrawdown([1, 2, 3])).toBe(0);
  });

  it("単純な下落: [1, -2] → DD=2", () => {
    // cumR: 0→1→-1, peak=1, min=-1, DD=2
    expect(computeMaxDrawdown([1, -2])).toBeCloseTo(2);
  });

  it("複数ドローダウン: 最大が採用される", () => {
    // cumR: 0→1→3→1→2→-1
    // Peak=3 (i=2), trough at -1 (i=5), DD=4
    expect(computeMaxDrawdown([1, 2, -2, 1, -3])).toBeCloseTo(4);
  });

  it("最初からマイナス", () => {
    // cumR: 0→-1→-3, peak=0, min=-3, DD=3
    expect(computeMaxDrawdown([-1, -2])).toBeCloseTo(3);
  });

  it("峰のみ（下落なし）", () => {
    expect(computeMaxDrawdown([2, 3, 1, 4])).toBe(0);
  });
});

// ── computeSharpe ────────────────────────────────────────────────────────

describe("computeSharpe", () => {
  it("0 件 → 0", () => {
    expect(computeSharpe([])).toBe(0);
  });

  it("1 件 → 0（標準偏差計算不能）", () => {
    expect(computeSharpe([2])).toBe(0);
  });

  it("均一（std=0）→ 0 を返す", () => {
    expect(computeSharpe([1, 1, 1])).toBe(0);
  });

  it("正の Sharpe: 全勝ち", () => {
    const sharpe = computeSharpe([2, 3, 2.5, 3]);
    expect(sharpe).toBeGreaterThan(0);
  });

  it("負の Sharpe: 全負け", () => {
    const sharpe = computeSharpe([-1, -1, -1.5]);
    expect(sharpe).toBeLessThan(0);
  });

  it("既知値テスト: [1, -1] → sharpe = 0", () => {
    // mean=0, std>0 → sharpe=0
    expect(computeSharpe([1, -1])).toBeCloseTo(0);
  });

  it("既知値テスト: [2, 4] → sharpe = mean/std = 3 / sqrt(2) ≈ 2.121", () => {
    // mean=3, s=sqrt((1+1)/1)=sqrt(2), sharpe=3/sqrt(2)≈2.121
    expect(computeSharpe([2, 4])).toBeCloseTo(3 / Math.sqrt(2), 3);
  });
});

// ── computeStats — エッジケース ───────────────────────────────────────────

describe("computeStats — エッジケース", () => {
  it("取引なし → 全項目が 0", () => {
    const stats = computeStats([]);
    expect(stats.totalTrades).toBe(0);
    expect(stats.closedTrades).toBe(0);
    expect(stats.wins).toBe(0);
    expect(stats.losses).toBe(0);
    expect(stats.winRate).toBe(0);
    expect(stats.avgPnlR).toBe(0);
    expect(stats.totalR).toBe(0);
    expect(stats.maxDrawdownR).toBe(0);
    expect(stats.sharpeRatio).toBe(0);
  });

  it("全取引 expired → closedTrades=0, winRate=0", () => {
    const stats = computeStats([
      makeTrade("expired", 0.5),
      makeTrade("expired", -0.3),
    ]);
    expect(stats.totalTrades).toBe(2);
    expect(stats.closedTrades).toBe(0);
    expect(stats.expired).toBe(2);
    expect(stats.winRate).toBe(0);
  });
});

// ── computeStats — 基本パス ──────────────────────────────────────────────

describe("computeStats — 基本パス", () => {
  it("全勝ち: winRate=1.0", () => {
    const stats = computeStats([
      makeTrade("closed_tp", 2.5),
      makeTrade("closed_tp", 1.8),
    ]);
    expect(stats.wins).toBe(2);
    expect(stats.losses).toBe(0);
    expect(stats.winRate).toBe(1.0);
  });

  it("全負け: winRate=0.0", () => {
    const stats = computeStats([
      makeTrade("closed_sl", -1),
      makeTrade("closed_sl", -1),
    ]);
    expect(stats.wins).toBe(0);
    expect(stats.losses).toBe(2);
    expect(stats.winRate).toBe(0.0);
  });

  it("混合: 3 勝 1 負 → winRate=0.75", () => {
    const stats = computeStats([
      makeTrade("closed_tp", 2.0),
      makeTrade("closed_tp", 1.5),
      makeTrade("closed_tp", 2.5),
      makeTrade("closed_sl", -1.0),
    ]);
    expect(stats.winRate).toBeCloseTo(0.75);
    expect(stats.totalTrades).toBe(4);
  });

  it("totalR は closed 取引の pnlR 合計", () => {
    const stats = computeStats([
      makeTrade("closed_tp", 2.0),
      makeTrade("closed_sl", -1.0),
      makeTrade("expired", 0.5), // expired は totalR に含めない
    ]);
    expect(stats.totalR).toBeCloseTo(1.0);
  });

  it("avgPnlR = totalR / closedTrades", () => {
    const stats = computeStats([
      makeTrade("closed_tp", 3.0),
      makeTrade("closed_sl", -1.0),
    ]);
    expect(stats.avgPnlR).toBeCloseTo(1.0);
  });

  it("expired は totalTrades に含まれる", () => {
    const stats = computeStats([
      makeTrade("closed_tp", 2.0),
      makeTrade("expired", 0.0),
    ]);
    expect(stats.totalTrades).toBe(2);
    expect(stats.expired).toBe(1);
    expect(stats.closedTrades).toBe(1);
  });
});

// ── computeStats — maxDrawdownR ───────────────────────────────────────────

describe("computeStats — maxDrawdownR", () => {
  it("全勝ち → maxDrawdownR=0", () => {
    const stats = computeStats([
      makeTrade("closed_tp", 2),
      makeTrade("closed_tp", 3),
    ]);
    expect(stats.maxDrawdownR).toBe(0);
  });

  it("勝ち後に大きな負け → ドローダウンが検出される", () => {
    // cumR: 0→2→5→4 → peak=5, trough=4, DD=1
    const stats = computeStats([
      makeTrade("closed_tp", 2),
      makeTrade("closed_tp", 3),
      makeTrade("closed_sl", -1),
    ]);
    expect(stats.maxDrawdownR).toBeCloseTo(1);
  });
});

// ── computeStats — sharpeRatio ─────────────────────────────────────────────

describe("computeStats — sharpeRatio", () => {
  it("1 取引 → sharpeRatio=0", () => {
    const stats = computeStats([makeTrade("closed_tp", 2)]);
    expect(stats.sharpeRatio).toBe(0);
  });

  it("正の Sharpe → sharpeRatio > 0", () => {
    const stats = computeStats([
      makeTrade("closed_tp", 2),
      makeTrade("closed_tp", 3),
      makeTrade("closed_tp", 2.5),
    ]);
    expect(stats.sharpeRatio).toBeGreaterThan(0);
  });
});

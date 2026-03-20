import { describe, it, expect } from "vitest";
import { runBacktest } from "../../../src/services/backtest/run-backtest.js";
import type { BacktestSignal } from "../../../src/domain/backtest/backtest-types.js";
import type { Candle } from "../../../src/domain/market/candle.js";

// ── テスト夾具 ────────────────────────────────────────────────────────────

/** デフォルト: long signal、entryHigh=100、SL=90、TP=120 */
function makeSignal(overrides: Partial<BacktestSignal> = {}): BacktestSignal {
  return {
    candleIndex: 0,
    direction: "long",
    entryHigh: 100,
    entryLow: 98,
    stopLoss: 90,
    takeProfit: 120,
    structureScore: 70,
    structureReason: "test",
    ...overrides,
  };
}

/**
 * シンプルなロウソク足を生成する。
 * open/close は low/high の中間値として設定。
 */
function makeCandle(low: number, high: number, close?: number): Candle {
  return {
    timestamp: 0,
    open: (low + high) / 2,
    high,
    low,
    close: close ?? (low + high) / 2,
    volume: 1000,
  };
}

/** 複数ロウソク足を生成（デフォルト: 何もヒットしない平穏なレンジ）*/
function makeFlatCandles(count: number, midPrice = 105): Candle[] {
  return Array.from({ length: count }, () =>
    makeCandle(midPrice - 2, midPrice + 2)
  );
}

// ── runBacktest — long TP ─────────────────────────────────────────────────

describe("runBacktest — long TP", () => {
  it("TP ヒット → status=closed_tp", () => {
    const signal = makeSignal();
    // candle 0: entry 足（走査対象外）
    // candle 1: TP ヒット
    const candles: Candle[] = [
      makeCandle(95, 105),  // index 0 = entry 足
      makeCandle(95, 125),  // index 1 = TP (120) ヒット
    ];
    const [trade] = runBacktest([signal], candles);
    expect(trade.status).toBe("closed_tp");
    expect(trade.exitPrice).toBe(120);
    expect(trade.exitCandleIndex).toBe(1);
  });

  it("long TP: pnlR が正の値", () => {
    const signal = makeSignal();
    const candles: Candle[] = [
      makeCandle(95, 105),
      makeCandle(95, 125),
    ];
    const [trade] = runBacktest([signal], candles);
    expect(trade.pnlR).toBeGreaterThan(0);
  });

  it("long TP: pnlR = (takeProfit - entryMid) / risk", () => {
    // entryMid = (98+100)/2 = 99, risk = 99-90 = 9
    // pnlR = (120-99)/9 = 21/9 ≈ 2.333
    const signal = makeSignal();
    const candles: Candle[] = [
      makeCandle(95, 105),
      makeCandle(95, 125),
    ];
    const [trade] = runBacktest([signal], candles);
    expect(trade.pnlR).toBeCloseTo(21 / 9, 3);
  });
});

// ── runBacktest — long SL ─────────────────────────────────────────────────

describe("runBacktest — long SL", () => {
  it("SL ヒット → status=closed_sl", () => {
    const signal = makeSignal();
    const candles: Candle[] = [
      makeCandle(95, 105),
      makeCandle(85, 105),  // SL (90) ヒット
    ];
    const [trade] = runBacktest([signal], candles);
    expect(trade.status).toBe("closed_sl");
    expect(trade.exitPrice).toBe(90);
  });

  it("long SL: pnlR が負の値", () => {
    const signal = makeSignal();
    const candles: Candle[] = [
      makeCandle(95, 105),
      makeCandle(85, 105),
    ];
    const [trade] = runBacktest([signal], candles);
    expect(trade.pnlR).toBeLessThan(0);
  });

  it("long SL: pnlR ≈ -1.0R（stopLoss = entryMid - risk）", () => {
    // entryMid=99, risk=9, SL=90 → pnlR=(90-99)/9=-1.0
    const signal = makeSignal();
    const candles: Candle[] = [
      makeCandle(95, 105),
      makeCandle(85, 105),
    ];
    const [trade] = runBacktest([signal], candles);
    expect(trade.pnlR).toBeCloseTo(-1.0, 3);
  });

  it("SL/TP 同一足ヒット → SL 優先（保守的）", () => {
    const signal = makeSignal();
    const candles: Candle[] = [
      makeCandle(95, 105),
      makeCandle(85, 130),  // low=85 → SL; high=130 → TP; SL 優先
    ];
    const [trade] = runBacktest([signal], candles);
    expect(trade.status).toBe("closed_sl");
  });
});

// ── runBacktest — short ───────────────────────────────────────────────────

describe("runBacktest — short", () => {
  it("short TP: candle.low <= takeProfit → closed_tp", () => {
    // short: entryLow=198 (worst fill), TP=180, SL=210
    const signal = makeSignal({
      direction: "short",
      entryHigh: 200,
      entryLow: 198,
      stopLoss: 210,
      takeProfit: 180,
    });
    const candles: Candle[] = [
      makeCandle(195, 205),   // entry 足
      makeCandle(175, 205),   // low=175 → TP (180) ヒット
    ];
    const [trade] = runBacktest([signal], candles);
    expect(trade.status).toBe("closed_tp");
    expect(trade.exitPrice).toBe(180);
  });

  it("short TP: pnlR が正の値", () => {
    // entryMid=(198+200)/2=199, risk=210-199=11
    // pnlR=(199-180)/11=19/11≈1.727
    const signal = makeSignal({
      direction: "short",
      entryHigh: 200,
      entryLow: 198,
      stopLoss: 210,
      takeProfit: 180,
    });
    const candles: Candle[] = [
      makeCandle(195, 205),
      makeCandle(175, 205),
    ];
    const [trade] = runBacktest([signal], candles);
    expect(trade.pnlR).toBeGreaterThan(0);
    expect(trade.pnlR).toBeCloseTo(19 / 11, 3);
  });

  it("short SL: candle.high >= stopLoss → closed_sl", () => {
    const signal = makeSignal({
      direction: "short",
      entryHigh: 200,
      entryLow: 198,
      stopLoss: 210,
      takeProfit: 180,
    });
    const candles: Candle[] = [
      makeCandle(195, 205),
      makeCandle(195, 215),  // high=215 → SL (210) ヒット
    ];
    const [trade] = runBacktest([signal], candles);
    expect(trade.status).toBe("closed_sl");
    expect(trade.exitPrice).toBe(210);
    expect(trade.pnlR).toBeLessThan(0);
  });
});

// ── runBacktest — expired ─────────────────────────────────────────────────

describe("runBacktest — expired", () => {
  it("データ終端まで TP/SL 未到達 → status=expired", () => {
    const signal = makeSignal();
    const candles: Candle[] = [
      makeCandle(95, 105),
      ...makeFlatCandles(5),
    ];
    const [trade] = runBacktest([signal], candles);
    expect(trade.status).toBe("expired");
  });

  it("expired: exitCandleIndex = candles.length - 1", () => {
    const signal = makeSignal();
    const candles: Candle[] = [makeCandle(95, 105), ...makeFlatCandles(3)];
    const [trade] = runBacktest([signal], candles);
    expect(trade.exitCandleIndex).toBe(candles.length - 1);
  });

  it("シグナルが最終足 → 次の足なし → expired", () => {
    const signal = makeSignal({ candleIndex: 2 });
    const candles: Candle[] = [
      makeCandle(95, 105),
      makeCandle(95, 105),
      makeCandle(95, 105),  // index 2 = entry
      // 後続足なし
    ];
    const [trade] = runBacktest([signal], candles);
    expect(trade.status).toBe("expired");
  });
});

// ── runBacktest — entryPrice ──────────────────────────────────────────────

describe("runBacktest — entryPrice", () => {
  it("long: entryPrice = entryHigh（保守的最悪フィル）", () => {
    const signal = makeSignal({ entryHigh: 100, entryLow: 98 });
    const candles: Candle[] = [makeCandle(95, 105), ...makeFlatCandles(3)];
    const [trade] = runBacktest([signal], candles);
    expect(trade.entryPrice).toBe(100);
  });

  it("short: entryPrice = entryLow（保守的最悪フィル）", () => {
    const signal = makeSignal({
      direction: "short",
      entryHigh: 200,
      entryLow: 198,
      stopLoss: 210,
      takeProfit: 180,
    });
    const candles: Candle[] = [makeCandle(195, 205), ...makeFlatCandles(3, 195)];
    const [trade] = runBacktest([signal], candles);
    expect(trade.entryPrice).toBe(198);
  });
});

// ── runBacktest — 複数シグナル ────────────────────────────────────────────

describe("runBacktest — 複数シグナル", () => {
  it("空シグナルリスト → 空の結果", () => {
    const candles = makeFlatCandles(10);
    expect(runBacktest([], candles)).toHaveLength(0);
  });

  it("2 シグナル → 2 取引", () => {
    const s1 = makeSignal({ candleIndex: 0 });
    const s2 = makeSignal({ direction: "short", candleIndex: 1, entryHigh: 110, entryLow: 108, stopLoss: 120, takeProfit: 90 });
    const candles = makeFlatCandles(10);
    const trades = runBacktest([s1, s2], candles);
    expect(trades).toHaveLength(2);
  });

  it("各シグナルが独立してシミュレートされる", () => {
    // signal1: long TP; signal2: long SL
    const s1 = makeSignal({ candleIndex: 0, entryHigh: 100, entryLow: 98, stopLoss: 90, takeProfit: 120 });
    const s2 = makeSignal({ candleIndex: 0, entryHigh: 100, entryLow: 98, stopLoss: 106, takeProfit: 150 });
    const candles: Candle[] = [
      makeCandle(95, 105),    // entry
      makeCandle(95, 125),    // s1 TP ヒット（120）; s2 SL はここでは未ヒット
    ];
    // s2 の SL=106 は candle[1] high=125 でヒット
    const trades = runBacktest([s1, s2], candles);
    expect(trades[0].status).toBe("closed_tp");
    expect(trades[1].status).toBe("closed_sl"); // SL=106, high=125 → SL ヒット
  });
});

// ── runBacktest — エッジケース ─────────────────────────────────────────────

describe("runBacktest — エッジケース", () => {
  it("risk=0（entryMid=stopLoss）→ pnlR=0（ゼロ除算回避）", () => {
    // entryHigh=entryLow=stopLoss → risk=0
    const signal = makeSignal({ entryHigh: 100, entryLow: 100, stopLoss: 100, takeProfit: 120 });
    const candles: Candle[] = [
      makeCandle(95, 105),
      makeCandle(95, 125),
    ];
    const [trade] = runBacktest([signal], candles);
    expect(trade.pnlR).toBe(0);
  });

  it("TP がちょうど high と等しい → TP ヒット判定", () => {
    const signal = makeSignal({ takeProfit: 125 });
    const candles: Candle[] = [
      makeCandle(95, 105),
      makeCandle(95, 125),  // high === takeProfit
    ];
    const [trade] = runBacktest([signal], candles);
    expect(trade.status).toBe("closed_tp");
  });

  it("SL がちょうど low と等しい → SL ヒット判定", () => {
    const signal = makeSignal({ stopLoss: 85 });
    const candles: Candle[] = [
      makeCandle(95, 105),
      makeCandle(85, 105),  // low === stopLoss
    ];
    const [trade] = runBacktest([signal], candles);
    expect(trade.status).toBe("closed_sl");
  });
});

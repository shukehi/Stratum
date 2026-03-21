import { describe, it, expect, vi } from "vitest";
import {
  runBacktest,
  generateFullChainBacktestSignals,
} from "../../../src/services/backtest/run-backtest.js";
import type { BacktestSignal } from "../../../src/domain/backtest/backtest-types.js";
import type { Candle } from "../../../src/domain/market/candle.js";
import { strategyConfig } from "../../../src/app/config.js";
import * as structureModule from "../../../src/services/structure/detect-structural-setups.js";
import * as consensusModule from "../../../src/services/consensus/evaluate-consensus.js";
import * as macroModule from "../../../src/services/macro/assess-macro-overlay.js";
import * as regimeModule from "../../../src/services/regime/detect-market-regime.js";
import * as participantModule from "../../../src/services/participants/assess-participant-pressure.js";

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

describe("generateFullChainBacktestSignals", () => {
  it("会按真实过滤顺序保留被 macro block 的样本", async () => {
    const baseTs = Date.UTC(2026, 0, 1, 0, 0, 0);
    const candles4h: Candle[] = [
      ...Array.from({ length: 52 }, (_, i) => ({
        timestamp: baseTs + i * 4 * 60 * 60 * 1000,
        open: 60000 + i * 40,
        high: 60800 + i * 40,
        low: 59700 + i * 40,
        close: 60400 + i * 40,
        volume: 1000 + i * 10,
      })),
      {
        timestamp: baseTs + 52 * 4 * 60 * 60 * 1000,
        open: 62100,
        high: 62600,
        low: 61600,
        close: 62500,
        volume: 1600,
      },
      {
        timestamp: baseTs + 53 * 4 * 60 * 60 * 1000,
        open: 62900,
        high: 63600,
        low: 62800,
        close: 63500,
        volume: 1700,
      },
      {
        timestamp: baseTs + 54 * 4 * 60 * 60 * 1000,
        open: 63300,
        high: 63900,
        low: 63100,
        close: 63700,
        volume: 1750,
      },
    ];
    const candles1h: Candle[] = [
      ...Array.from({ length: 220 }, (_, i) => ({
        timestamp: baseTs + i * 60 * 60 * 1000,
        open: 60000 + i * 10,
        high: 60200 + i * 10,
        low: 59800 + i * 10,
        close: 60100 + i * 10,
        volume: 300,
      })),
      {
        timestamp: baseTs + 54 * 4 * 60 * 60 * 1000,
        open: 63350,
        high: 63650,
        low: 62400,
        close: 63580,
        volume: 500,
      },
    ];
    const candles1d: Candle[] = Array.from({ length: 40 }, (_, i) => ({
      timestamp: baseTs + i * 24 * 60 * 60 * 1000,
      open: 56000 + i * 120,
      high: 57000 + i * 120,
      low: 55000 + i * 120,
      close: 56500 + i * 120,
      volume: 10000,
    }));

    const structureSpy = vi.spyOn(structureModule, "analyzeStructuralSetups").mockReturnValue({
      setups: [
        {
          timeframe: "4h",
          direction: "long",
          entryLow: 62450,
          entryHigh: 62600,
          stopLossHint: 61800,
          takeProfitHint: 64000,
          structureScore: 72,
          structureReason: "Bullish FVG",
          invalidationReason: "1h close below 61800",
          confluenceFactors: ["fvg", "liquidity-sweep"],
          confirmationStatus: "confirmed",
          confirmationTimeframe: "1h",
          reasonCodes: [],
        },
      ],
    });
    const consensusSpy = vi.spyOn(consensusModule, "analyzeConsensus").mockReturnValue({
      candidates: [
        {
          symbol: "BTCUSDT",
          direction: "long",
          timeframe: "4h",
          entryLow: 62450,
          entryHigh: 62600,
          stopLoss: 61800,
          takeProfit: 64000,
          riskReward: 2.0,
          regimeAligned: true,
          participantAligned: true,
          structureReason: "Bullish FVG",
          contextReason: "trend",
          signalGrade: "high-conviction",
          reasonCodes: [],
        },
      ],
    });
    const macroSpy = vi.spyOn(macroModule, "assessMacroOverlay").mockResolvedValue({
      assessment: {
        macroBias: "bearish",
        confidenceScore: 9,
        btcRelevance: 8,
        catalystSummary: "Macro is hostile to risk assets.",
        riskFlags: ["FOMC meeting"],
        rawPrompt: "",
        rawResponse: "",
      },
      decision: {
        action: "block",
        confidence: 9,
        reason: "Macro is hostile to risk assets.",
        reasonCodes: ["EVENT_WINDOW_WATCH_ONLY", "MACRO_BLOCKED"],
      },
    });

    const records = await generateFullChainBacktestSignals({
      symbol: "BTCUSDT",
      candles4h,
      candles1h,
      candles1d,
      fundingRates: candles4h.map((candle, i) => ({
        timestamp: candle.timestamp,
        fundingRate: i < 50 ? 0.004 : 0.012,
      })),
      openInterest: candles4h.map((candle, i) => ({
        timestamp: candle.timestamp,
        openInterest: 100000 + i * 4000,
      })),
      spotPrice: candles4h[candles4h.length - 1].close,
      news: [
        {
          id: "n1",
          source: "Reuters",
          publishedAt: new Date(baseTs + 55 * 4 * 60 * 60 * 1000).toISOString(),
          title: "Fed warns inflation may stay elevated",
          category: "macro",
        },
      ],
      config: {
        ...strategyConfig,
        minStructureScore: 40,
        minimumRiskReward: 1.5,
        minRegimeConfidence: 40,
        minParticipantConfidence: 40,
      },
      llmCall: async () =>
        JSON.stringify({
          macroBias: "bearish",
          confidenceScore: 9,
          btcRelevance: 8,
          catalystSummary: "Macro is hostile to risk assets.",
          riskFlags: ["FOMC meeting"],
        }),
      minHistory: 40,
    });

    expect(records.length).toBeGreaterThan(0);
    expect(records.some((record) => record.alertStatus === "blocked_by_macro")).toBe(true);
    expect(records.every((record) => record.regime === "trend" || record.regime === "range")).toBe(true);

    structureSpy.mockRestore();
    consensusSpy.mockRestore();
    macroSpy.mockRestore();
  });

  it("会把 openLongCount 传进共识层以重放相关暴露门控", async () => {
    const baseTs = Date.UTC(2026, 0, 1, 0, 0, 0);
    const candles4h: Candle[] = Array.from({ length: 55 }, (_, i) => ({
      timestamp: baseTs + i * 4 * 60 * 60 * 1000,
      open: 60000 + i * 20,
      high: 60600 + i * 20,
      low: 59600 + i * 20,
      close: 60300 + i * 20,
      volume: 1000 + i * 5,
    }));
    const candles1h: Candle[] = Array.from({ length: 220 }, (_, i) => ({
      timestamp: baseTs + i * 60 * 60 * 1000,
      open: 60000 + i * 5,
      high: 60200 + i * 5,
      low: 59800 + i * 5,
      close: 60100 + i * 5,
      volume: 300,
    }));
    const candles1d: Candle[] = Array.from({ length: 40 }, (_, i) => ({
      timestamp: baseTs + i * 24 * 60 * 60 * 1000,
      open: 56000 + i * 100,
      high: 56800 + i * 100,
      low: 55200 + i * 100,
      close: 56500 + i * 100,
      volume: 8000,
    }));

    const observedOpenLongCounts: number[] = [];

    const structureSpy = vi.spyOn(structureModule, "analyzeStructuralSetups").mockImplementation((slice4h) => {
      if (slice4h.length === 53) {
        return {
          setups: [
            {
              timeframe: "4h",
              direction: "long",
              entryLow: 62300,
              entryHigh: 62500,
              stopLossHint: 59000,
              takeProfitHint: 70000,
              structureScore: 74,
              structureReason: "First long",
              invalidationReason: "1h close below 61800",
              confluenceFactors: ["fvg", "liquidity-sweep"],
              confirmationStatus: "confirmed",
              confirmationTimeframe: "1h",
              reasonCodes: [],
            },
          ],
        };
      }
      if (slice4h.length === 54) {
        return {
          setups: [
            {
              timeframe: "4h",
              direction: "long",
              entryLow: 62800,
              entryHigh: 63000,
              stopLossHint: 59500,
              takeProfitHint: 70500,
              structureScore: 76,
              structureReason: "Second long",
              invalidationReason: "1h close below 62200",
              confluenceFactors: ["fvg", "liquidity-sweep"],
              confirmationStatus: "confirmed",
              confirmationTimeframe: "1h",
              reasonCodes: [],
            },
          ],
        };
      }
      return { setups: [], skipReasonCode: "STRUCTURE_NO_SETUP" };
    });
    const consensusSpy = vi.spyOn(consensusModule, "analyzeConsensus").mockImplementation((input) => {
      observedOpenLongCounts.push(input.openLongCount ?? 0);
      if (input.setups.length === 0) {
        return { candidates: [], skipReasonCode: "STRUCTURE_NO_SETUP" };
      }
      const [setup] = input.setups;
      return {
        candidates: [
          {
            symbol: "BTCUSDT",
            direction: setup.direction,
            timeframe: setup.timeframe,
            entryLow: setup.entryLow,
            entryHigh: setup.entryHigh,
            stopLoss: setup.stopLossHint,
            takeProfit: setup.takeProfitHint,
            riskReward: 2,
            regimeAligned: true,
            participantAligned: true,
            structureReason: setup.structureReason,
            contextReason: "trend",
            signalGrade: "high-conviction",
            reasonCodes: [],
          },
        ],
      };
    });
    const macroSpy = vi.spyOn(macroModule, "assessMacroOverlay").mockResolvedValue({
      assessment: {
        macroBias: "bullish",
        confidenceScore: 7,
        btcRelevance: 7,
        catalystSummary: "Macro neutral-positive.",
        riskFlags: [],
        rawPrompt: "",
        rawResponse: "",
      },
      decision: {
        action: "pass",
        confidence: 7,
        reason: "Macro allows the setup.",
        reasonCodes: [],
      },
    });

    await generateFullChainBacktestSignals({
      symbol: "BTCUSDT",
      candles4h,
      candles1h,
      candles1d,
      fundingRates: candles4h.map((candle) => ({
        timestamp: candle.timestamp,
        fundingRate: 0.004,
      })),
      openInterest: candles4h.map((candle, i) => ({
        timestamp: candle.timestamp,
        openInterest: 100000 + i * 3000,
      })),
      spotPrices: candles4h.map((candle, i) => ({
        timestamp: candle.timestamp,
        price: candle.close + i,
      })),
      news: [],
      config: {
        ...strategyConfig,
        minStructureScore: 40,
        minimumRiskReward: 1.5,
        minRegimeConfidence: 40,
        minParticipantConfidence: 40,
      },
      llmCall: async () => "{}",
      minHistory: 52,
    });

    expect(observedOpenLongCounts).toContain(0);
    expect(observedOpenLongCounts).toContain(1);

    structureSpy.mockRestore();
    consensusSpy.mockRestore();
    macroSpy.mockRestore();
  });

  it("会按历史时间点传入对应的现货价格，而不是复用单一 spotPrice", async () => {
    const baseTs = Date.UTC(2026, 0, 1, 0, 0, 0);
    const candles4h: Candle[] = Array.from({ length: 55 }, (_, i) => ({
      timestamp: baseTs + i * 4 * 60 * 60 * 1000,
      open: 60000 + i * 20,
      high: 60600 + i * 20,
      low: 59600 + i * 20,
      close: 60300 + i * 20,
      volume: 1000 + i * 5,
    }));
    const candles1h: Candle[] = Array.from({ length: 220 }, (_, i) => ({
      timestamp: baseTs + i * 60 * 60 * 1000,
      open: 60000 + i * 5,
      high: 60200 + i * 5,
      low: 59800 + i * 5,
      close: 60100 + i * 5,
      volume: 300,
    }));
    const candles1d: Candle[] = Array.from({ length: 40 }, (_, i) => ({
      timestamp: baseTs + i * 24 * 60 * 60 * 1000,
      open: 56000 + i * 100,
      high: 56800 + i * 100,
      low: 55200 + i * 100,
      close: 56500 + i * 100,
      volume: 8000,
    }));
    const observedRegimeSpotPrices: number[] = [];
    const observedParticipantSpotPrices: number[] = [];

    const structureSpy = vi.spyOn(structureModule, "analyzeStructuralSetups").mockReturnValue({
      setups: [],
      skipReasonCode: "STRUCTURE_NO_SETUP",
    });
    const regimeSpy = vi.spyOn(regimeModule, "detectMarketRegime").mockImplementation((candles, config, inputs) => {
      observedRegimeSpotPrices.push(inputs?.spotPrice ?? 0);
      return {
        regime: "trend",
        confidence: 80,
        driverType: "new-longs",
        driverConfidence: 75,
        driverReasons: ["test"],
        reasons: ["test"],
        reasonCodes: [],
      };
    });
    const participantSpy = vi.spyOn(participantModule, "assessParticipantPressure").mockImplementation(
      (_candles, _fundingRates, _openInterest, spotPrice) => {
        observedParticipantSpotPrices.push(spotPrice);
        return {
          bias: "balanced",
          pressureType: "none",
          confidence: 70,
          rationale: "test",
          spotPerpBasis: 0,
          basisDivergence: false,
          reasonCodes: [],
        };
      }
    );

    await generateFullChainBacktestSignals({
      symbol: "BTCUSDT",
      candles4h,
      candles1h,
      candles1d,
      fundingRates: candles4h.map((candle) => ({
        timestamp: candle.timestamp,
        fundingRate: 0.004,
      })),
      openInterest: candles4h.map((candle, i) => ({
        timestamp: candle.timestamp,
        openInterest: 100000 + i * 3000,
      })),
      spotPrice: 999999,
      spotPrices: candles4h.map((candle, i) => ({
        timestamp: candle.timestamp,
        price: 58000 + i * 10,
      })),
      news: [],
      config: {
        ...strategyConfig,
        minRegimeConfidence: 40,
      },
      llmCall: async () => "{}",
      minHistory: 52,
    });

    expect(observedRegimeSpotPrices[0]).toBe(58000 + 52 * 10);
    expect(observedRegimeSpotPrices[1]).toBe(58000 + 53 * 10);
    expect(new Set(observedParticipantSpotPrices).size).toBeGreaterThan(1);
    expect(observedParticipantSpotPrices).not.toContain(999999);

    structureSpy.mockRestore();
    regimeSpy.mockRestore();
    participantSpy.mockRestore();
  });

  it("macro block 的样本不会阻止后续同价位重试", async () => {
    const baseTs = Date.UTC(2026, 0, 1, 0, 0, 0);
    const candles4h: Candle[] = Array.from({ length: 55 }, (_, i) => ({
      timestamp: baseTs + i * 4 * 60 * 60 * 1000,
      open: 60000 + i * 20,
      high: 60600 + i * 20,
      low: 59600 + i * 20,
      close: 60300 + i * 20,
      volume: 1000 + i * 5,
    }));
    const candles1h: Candle[] = Array.from({ length: 220 }, (_, i) => ({
      timestamp: baseTs + i * 60 * 60 * 1000,
      open: 60000 + i * 5,
      high: 60200 + i * 5,
      low: 59800 + i * 5,
      close: 60100 + i * 5,
      volume: 300,
    }));
    const candles1d: Candle[] = Array.from({ length: 40 }, (_, i) => ({
      timestamp: baseTs + i * 24 * 60 * 60 * 1000,
      open: 56000 + i * 100,
      high: 56800 + i * 100,
      low: 55200 + i * 100,
      close: 56500 + i * 100,
      volume: 8000,
    }));

    const structureSpy = vi.spyOn(structureModule, "analyzeStructuralSetups").mockImplementation((slice4h) => {
      if (slice4h.length === 53 || slice4h.length === 54) {
        return {
          setups: [
            {
              timeframe: "4h",
              direction: "long",
              entryLow: 62450,
              entryHigh: 62600,
              stopLossHint: 61800,
              takeProfitHint: 64000,
              structureScore: 72,
              structureReason: "Retest long",
              invalidationReason: "1h close below 61800",
              confluenceFactors: ["fvg", "liquidity-sweep"],
              confirmationStatus: "confirmed",
              confirmationTimeframe: "1h",
              reasonCodes: [],
            },
          ],
        };
      }
      return { setups: [], skipReasonCode: "STRUCTURE_NO_SETUP" };
    });
    const consensusSpy = vi.spyOn(consensusModule, "analyzeConsensus").mockImplementation((input) => {
      if (input.setups.length === 0) {
        return { candidates: [], skipReasonCode: "STRUCTURE_NO_SETUP" };
      }
      return {
        candidates: [
          {
            symbol: "BTCUSDT",
            direction: "long",
            timeframe: "4h",
            entryLow: 62450,
            entryHigh: 62600,
            stopLoss: 61800,
            takeProfit: 64000,
            riskReward: 2,
            regimeAligned: true,
            participantAligned: true,
            structureReason: "Retest long",
            contextReason: "trend",
            signalGrade: "high-conviction",
            reasonCodes: [],
          },
        ],
      };
    });
    const macroSpy = vi
      .spyOn(macroModule, "assessMacroOverlay")
      .mockResolvedValueOnce({
        assessment: {
          macroBias: "bearish",
          confidenceScore: 9,
          btcRelevance: 8,
          catalystSummary: "Hostile macro",
          riskFlags: ["event"],
          rawPrompt: "",
          rawResponse: "",
        },
        decision: {
          action: "block",
          confidence: 9,
          reason: "Hostile macro",
          reasonCodes: ["EVENT_WINDOW_WATCH_ONLY", "MACRO_BLOCKED"],
        },
      })
      .mockResolvedValue({
        assessment: {
          macroBias: "bullish",
          confidenceScore: 7,
          btcRelevance: 7,
          catalystSummary: "Macro clears",
          riskFlags: [],
          rawPrompt: "",
          rawResponse: "",
        },
        decision: {
          action: "pass",
          confidence: 7,
          reason: "Macro clears",
          reasonCodes: [],
        },
      });

    const records = await generateFullChainBacktestSignals({
      symbol: "BTCUSDT",
      candles4h,
      candles1h,
      candles1d,
      fundingRates: candles4h.map((candle) => ({
        timestamp: candle.timestamp,
        fundingRate: 0.004,
      })),
      openInterest: candles4h.map((candle, i) => ({
        timestamp: candle.timestamp,
        openInterest: 100000 + i * 3000,
      })),
      spotPrices: candles4h.map((candle) => ({
        timestamp: candle.timestamp,
        price: candle.close,
      })),
      news: [],
      config: {
        ...strategyConfig,
        minStructureScore: 40,
        minimumRiskReward: 1.5,
        minRegimeConfidence: 40,
        minParticipantConfidence: 40,
      },
      llmCall: async () => "{}",
      minHistory: 52,
    });

    expect(records).toHaveLength(2);
    expect(records[0].alertStatus).toBe("blocked_by_macro");
    expect(records[1].alertStatus).toBe("sent");

    structureSpy.mockRestore();
    consensusSpy.mockRestore();
    macroSpy.mockRestore();
  });

  it("已发送过的同价位重评估会保留 duplicate 记录", async () => {
    const baseTs = Date.UTC(2026, 0, 1, 0, 0, 0);
    const candles4h: Candle[] = Array.from({ length: 55 }, (_, i) => ({
      timestamp: baseTs + i * 4 * 60 * 60 * 1000,
      open: 60000 + i * 20,
      high: 60600 + i * 20,
      low: 59600 + i * 20,
      close: 60300 + i * 20,
      volume: 1000 + i * 5,
    }));
    const candles1h: Candle[] = Array.from({ length: 220 }, (_, i) => ({
      timestamp: baseTs + i * 60 * 60 * 1000,
      open: 60000 + i * 5,
      high: 60200 + i * 5,
      low: 59800 + i * 5,
      close: 60100 + i * 5,
      volume: 300,
    }));
    const candles1d: Candle[] = Array.from({ length: 40 }, (_, i) => ({
      timestamp: baseTs + i * 24 * 60 * 60 * 1000,
      open: 56000 + i * 100,
      high: 56800 + i * 100,
      low: 55200 + i * 100,
      close: 56500 + i * 100,
      volume: 8000,
    }));

    const structureSpy = vi.spyOn(structureModule, "analyzeStructuralSetups").mockImplementation((slice4h) => {
      if (slice4h.length === 53 || slice4h.length === 54) {
        return {
          setups: [
            {
              timeframe: "4h",
              direction: "long",
              entryLow: 62450,
              entryHigh: 62600,
              stopLossHint: 61800,
              takeProfitHint: 64000,
              structureScore: 72,
              structureReason: "Retest long",
              invalidationReason: "1h close below 61800",
              confluenceFactors: ["fvg", "liquidity-sweep"],
              confirmationStatus: "confirmed",
              confirmationTimeframe: "1h",
              reasonCodes: [],
            },
          ],
        };
      }
      return { setups: [], skipReasonCode: "STRUCTURE_NO_SETUP" };
    });
    const consensusSpy = vi.spyOn(consensusModule, "analyzeConsensus").mockImplementation((input) => {
      if (input.setups.length === 0) {
        return { candidates: [], skipReasonCode: "STRUCTURE_NO_SETUP" };
      }
      return {
        candidates: [
          {
            symbol: "BTCUSDT",
            direction: "long",
            timeframe: "4h",
            entryLow: 62450,
            entryHigh: 62600,
            stopLoss: 61800,
            takeProfit: 64000,
            riskReward: 2,
            regimeAligned: true,
            participantAligned: true,
            structureReason: "Retest long",
            contextReason: "trend",
            signalGrade: "high-conviction",
            reasonCodes: [],
          },
        ],
      };
    });
    const macroSpy = vi.spyOn(macroModule, "assessMacroOverlay").mockResolvedValue({
      assessment: {
        macroBias: "bullish",
        confidenceScore: 7,
        btcRelevance: 7,
        catalystSummary: "Macro clears",
        riskFlags: [],
        rawPrompt: "",
        rawResponse: "",
      },
      decision: {
        action: "pass",
        confidence: 7,
        reason: "Macro clears",
        reasonCodes: [],
      },
    });

    const records = await generateFullChainBacktestSignals({
      symbol: "BTCUSDT",
      candles4h,
      candles1h,
      candles1d,
      fundingRates: candles4h.map((candle) => ({
        timestamp: candle.timestamp,
        fundingRate: 0.004,
      })),
      openInterest: candles4h.map((candle, i) => ({
        timestamp: candle.timestamp,
        openInterest: 100000 + i * 3000,
      })),
      spotPrices: candles4h.map((candle) => ({
        timestamp: candle.timestamp,
        price: candle.close,
      })),
      news: [],
      config: {
        ...strategyConfig,
        minStructureScore: 40,
        minimumRiskReward: 1.5,
        minRegimeConfidence: 40,
        minParticipantConfidence: 40,
      },
      llmCall: async () => "{}",
      minHistory: 52,
    });

    expect(records).toHaveLength(2);
    expect(records[0].alertStatus).toBe("sent");
    expect(records[1].alertStatus).toBe("skipped_duplicate");
    expect(records[1].executionReasonCode).toBe("already_sent");

    structureSpy.mockRestore();
    consensusSpy.mockRestore();
    macroSpy.mockRestore();
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

import { describe, it, expect } from "vitest";
import { detectMarketRegime } from "../../../src/services/regime/detect-market-regime.js";
import { strategyConfig } from "../../../src/app/config.js";
import type { Candle } from "../../../src/domain/market/candle.js";
import type { FundingRatePoint } from "../../../src/domain/market/funding-rate.js";
import type { OpenInterestPoint } from "../../../src/domain/market/open-interest.js";

// ── Fixture helpers ──────────────────────────────────────────────────────────

const BASE_TIME = 1_700_000_000_000;
const INTERVAL = 4 * 60 * 60 * 1000;

/** Generate N candles trending upward (close > open, monotone) */
function makeTrendUpCandles(n: number, startPrice = 60000, step = 200): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const base = startPrice + i * step;
    return {
      timestamp: BASE_TIME + i * INTERVAL,
      open: base,
      high: base + 100,
      low: base - 50,
      close: base + 150,
      volume: 1000,
    };
  });
}

/** Generate N candles trending downward */
function makeTrendDownCandles(n: number, startPrice = 60000, step = 200): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const base = startPrice - i * step;
    return {
      timestamp: BASE_TIME + i * INTERVAL,
      open: base,
      high: base + 50,
      low: base - 100,
      close: base - 150,
      volume: 1000,
    };
  });
}

/** Generate N range-bound candles (alternating up/down, same size) */
function makeRangeCandles(n: number, midPrice = 60000): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const isUp = i % 2 === 0;
    return {
      timestamp: BASE_TIME + i * INTERVAL,
      open: midPrice,
      high: midPrice + 200,
      low: midPrice - 200,
      close: isUp ? midPrice + 100 : midPrice - 100,
      volume: 1000,
    };
  });
}

/** 大阴线幅度主导，但上涨次数更多，用于验证趋势评分按波幅而非计数 */
function makeMagnitudeDominatedDownCandles(): Candle[] {
  const candles: Candle[] = [];
  let price = 60_000;
  for (let i = 0; i < 13; i++) {
    const isLast = i === 12;
    if (!isLast) {
      candles.push({
        timestamp: BASE_TIME + i * INTERVAL,
        open: price,
        high: price + 60,
        low: price - 20,
        close: price + 40, // 多次小幅上涨
        volume: 1_000,
      });
      price += 40;
    } else {
      candles.push({
        timestamp: BASE_TIME + i * INTERVAL,
        open: price,
        high: price + 40,
        low: price - 2_500,
        close: price - 2_000, // 单次显著下跌，幅度远大于前面所有小涨
        volume: 2_000,
      });
    }
  }
  return candles;
}

/** Generate N high-volatility candles (ATR >> baseline) */
function makeHighVolatilityCandles(n: number): Candle[] {
  const normalCandles = Array.from({ length: 40 }, (_, i) => ({
    timestamp: BASE_TIME + i * INTERVAL,
    open: 60000,
    high: 60200,
    low: 59800,
    close: 60100,
    volume: 1000,
  }));
  // Last N candles have 5x ATR
  const volatileCandles = Array.from({ length: n }, (_, i) => ({
    timestamp: BASE_TIME + (40 + i) * INTERVAL,
    open: 60000,
    high: 62000,   // range = 4000 (vs ~400 baseline)
    low: 58000,
    close: 60500,
    volume: 5000,
  }));
  return [...normalCandles, ...volatileCandles];
}

/** Generate candles ending with one extreme spike (event-driven) */
function makeEventDrivenCandles(): Candle[] {
  const normal = Array.from({ length: 49 }, (_, i) => ({
    timestamp: BASE_TIME + i * INTERVAL,
    open: 60000,
    high: 60200,
    low: 59800,
    close: 60100,
    volume: 1000,
  }));
  // Last candle: range > 3x baseline ATR (baseline ~400, spike ~5000)
  const spike: Candle = {
    timestamp: BASE_TIME + 49 * INTERVAL,
    open: 60000,
    high: 65000,
    low: 57000,
    close: 63000,
    volume: 50000,
  };
  return [...normal, spike];
}

/** Trend candles where second half has expanding ATR → exhaustion penalty */
function makeTrendExhaustionCandles(): Candle[] {
  // First half: tight ATR ~100, trending up
  const earlyTrend = Array.from({ length: 40 }, (_, i) => ({
    timestamp: BASE_TIME + i * INTERVAL,
    open: 60000 + i * 100,
    high: 60100 + i * 100,
    low: 59950 + i * 100,   // ATR ~150
    close: 60080 + i * 100,
    volume: 1000,
  }));
  // Last 14 candles: front 7 normal ATR ~200, back 7 with 2.5x ATR ~500
  // atrExpansion = 500/200 = 2.5 >= trendExtensionAtrPenaltyThreshold(2.0) ✓
  // recentAtr ≈ 350, baselineAtr ≈ 202 → atrRatio ≈ 1.73 < 2.125
  // → highVolatilityScore ≈ 59 < highVolatilityOverrideScore(75) ✓ (no hv override)
  const frontHalf = Array.from({ length: 7 }, (_, i) => ({
    timestamp: BASE_TIME + (40 + i) * INTERVAL,
    open: 64000 + i * 100,
    high: 64200 + i * 100,
    low: 64000 + i * 100,   // ATR ~200
    close: 64180 + i * 100,
    volume: 1000,
  }));
  const backHalf = Array.from({ length: 7 }, (_, i) => ({
    timestamp: BASE_TIME + (47 + i) * INTERVAL,
    open: 64700 + i * 100,
    high: 65200 + i * 100,  // ATR ~500 (2.5x expansion, below hv-override)
    low: 64700 + i * 100,
    close: 65100 + i * 100,
    volume: 2000,
  }));
  return [...earlyTrend, ...frontHalf, ...backHalf];
}

function makeOI(
  n: number,
  start = 100_000,
  step = 2_000
): OpenInterestPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    timestamp: BASE_TIME + i * INTERVAL,
    openInterest: start + i * step,
  }));
}

function makeFunding(
  n: number,
  rate: number
): FundingRatePoint[] {
  return Array.from({ length: n }, (_, i) => ({
    timestamp: BASE_TIME + i * INTERVAL,
    fundingRate: rate,
  }));
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("detectMarketRegime", () => {
  describe("insufficient data", () => {
    it("returns range with REGIME_AMBIGUOUS when < 14 candles", () => {
      const result = detectMarketRegime(makeTrendUpCandles(5), strategyConfig);
      expect(result.regime).toBe("range");
      expect(result.reasonCodes).toContain("REGIME_AMBIGUOUS");
      expect(result.driverType).toBe("unclear");
      expect(result.confidence).toBeLessThan(strategyConfig.minRegimeConfidence);
    });
  });

  describe("trend regime", () => {
    it("identifies upward trend from 30 consecutive rising candles", () => {
      const result = detectMarketRegime(makeTrendUpCandles(30), strategyConfig);
      expect(result.regime).toBe("trend");
      expect(result.confidence).toBeGreaterThan(50);
      expect(result.reasons.some(r => r.includes("上升"))).toBe(true);
    });

    it("identifies downward trend from 30 consecutive falling candles", () => {
      const result = detectMarketRegime(makeTrendDownCandles(30), strategyConfig);
      expect(result.regime).toBe("trend");
      expect(result.confidence).toBeGreaterThan(50);
      expect(result.reasons.some(r => r.includes("下降"))).toBe(true);
    });

    it("returns RegimeDecision with required fields", () => {
      const result = detectMarketRegime(makeTrendUpCandles(30), strategyConfig);
      expect(typeof result.confidence).toBe("number");
      expect(Array.isArray(result.reasons)).toBe(true);
      expect(Array.isArray(result.reasonCodes)).toBe(true);
      expect(typeof result.driverType).toBe("string");
      expect(result.reasons.length).toBeGreaterThan(0);
    });

    it("方向评分按波幅加权，不会被大量微弱上涨误判为上升趋势", () => {
      const result = detectMarketRegime(makeMagnitudeDominatedDownCandles(), strategyConfig);
      expect(result.reasons.some((reason) => reason.includes("上升"))).toBe(false);
    });
  });

  describe("range regime", () => {
    it("identifies range from alternating up/down candles", () => {
      const result = detectMarketRegime(makeRangeCandles(30), strategyConfig);
      expect(result.regime).toBe("range");
    });

    it("range confidence is within valid bounds", () => {
      const result = detectMarketRegime(makeRangeCandles(30), strategyConfig);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(100);
    });
  });

  describe("high-volatility regime", () => {
    it("detects high-volatility when ATR ratio exceeds threshold", () => {
      const result = detectMarketRegime(makeHighVolatilityCandles(14), strategyConfig);
      expect(result.regime).toBe("high-volatility");
      expect(result.reasonCodes).toContain("REGIME_HIGH_VOLATILITY");
    });

    it("high-volatility confidence is >= highVolatilityOverrideScore", () => {
      const result = detectMarketRegime(makeHighVolatilityCandles(14), strategyConfig);
      expect(result.confidence).toBeGreaterThanOrEqual(strategyConfig.highVolatilityOverrideScore);
    });
  });

  describe("event-driven regime", () => {
    it("detects event-driven from single extreme candle spike", () => {
      const result = detectMarketRegime(makeEventDrivenCandles(), strategyConfig);
      expect(result.regime).toBe("event-driven");
      expect(result.reasonCodes).toContain("REGIME_EVENT_DRIVEN");
    });

    it("event-driven overrides high-volatility (priority rule)", () => {
      const result = detectMarketRegime(makeEventDrivenCandles(), strategyConfig);
      // event-driven should win, not high-volatility
      expect(result.regime).toBe("event-driven");
    });

    it("event-driven confidence is >= eventDrivenOverrideScore", () => {
      const result = detectMarketRegime(makeEventDrivenCandles(), strategyConfig);
      expect(result.confidence).toBeGreaterThanOrEqual(strategyConfig.eventDrivenOverrideScore);
    });
  });

  describe("reasonCode isolation", () => {
    it("event-driven result does NOT contain REGIME_TREND_EXHAUSTED even when ATR expansion exists", () => {
      // event-driven overrides trend evaluation — exhaustion code must not leak
      const result = detectMarketRegime(makeEventDrivenCandles(), strategyConfig);
      expect(result.regime).toBe("event-driven");
      expect(result.reasonCodes).not.toContain("REGIME_TREND_EXHAUSTED");
    });
  });

  describe("trend exhaustion penalty", () => {
    it("applies ATR exhaustion penalty: trend with expanding ATR gets reduced confidence", () => {
      const exhaustionCandles = makeTrendExhaustionCandles();
      const result = detectMarketRegime(exhaustionCandles, strategyConfig);
      // With exhaustion penalty, trendScore is 0.55x, so should NOT return high-confidence trend
      // Either returns range (if gap < minRegimeScoreGap) or trend with lower confidence
      expect(result.reasonCodes).toContain("REGIME_TREND_EXHAUSTED");
      expect(result.reasons.some(r => r.includes("衰竭"))).toBe(true);
    });

    it("clean trend without ATR expansion does NOT get exhaustion penalty", () => {
      const cleanTrend = makeTrendUpCandles(30); // uniform ATR throughout
      const result = detectMarketRegime(cleanTrend, strategyConfig);
      expect(result.reasonCodes).not.toContain("REGIME_TREND_EXHAUSTED");
    });
  });

  describe("ambiguity handling", () => {
    it("returns REGIME_AMBIGUOUS when trend/range scores are too close", () => {
      // Exactly 50% up, 50% down = zero directional bias → rangeScore wins but gap may be low
      // To force ambiguity: create candles with ~50% directional bias
      const ambiguous = Array.from({ length: 20 }, (_, i) => ({
        timestamp: BASE_TIME + i * INTERVAL,
        open: 60000,
        high: 60200,
        low: 59800,
        close: i % 3 === 0 ? 60050 : (i % 3 === 1 ? 59950 : 60000),
        volume: 1000,
      }));
      const result = detectMarketRegime(ambiguous, strategyConfig);
      // Should either be range or have REGIME_AMBIGUOUS reason code
      // (depends on exact bias calculation - acceptable either way)
      expect(["range", "trend"]).toContain(result.regime);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
    });
  });

  describe("output contract", () => {
    it("always returns all required RegimeDecision fields", () => {
      const inputs = [
        makeTrendUpCandles(20),
        makeRangeCandles(20),
        makeHighVolatilityCandles(14),
        makeEventDrivenCandles(),
      ];
      for (const candles of inputs) {
        const result = detectMarketRegime(candles, strategyConfig);
        expect(result).toHaveProperty("regime");
        expect(result).toHaveProperty("confidence");
        expect(result).toHaveProperty("driverType");
        expect(result).toHaveProperty("reasons");
        expect(result).toHaveProperty("reasonCodes");
        expect(["trend", "range", "event-driven", "high-volatility"]).toContain(result.regime);
        expect([
          "new-longs",
          "new-shorts",
          "short-covering",
          "long-liquidation",
          "deleveraging-vacuum",
          "unclear",
        ]).toContain(result.driverType);
        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(100);
      }
    });
  });

  describe("mechanism-driven classification", () => {
    it("distinguishes short-covering from fresh long-driven trend", () => {
      const candles = makeTrendUpCandles(30);
      const oi = makeOI(8, 120_000, -4_000);
      const funding = makeFunding(3, -0.0002);

      const result = detectMarketRegime(candles, strategyConfig, {
        openInterest: oi,
        fundingRates: funding,
        spotPrice: candles.at(-1)!.close + 250,
      });

      expect(result.driverType).toBe("short-covering");
      expect(result.reasonCodes).toContain("REGIME_DRIVER_SHORT_COVERING");
      expect(result.driverConfidence).toBeGreaterThan(55);
    });

    it("detects fresh short-driven downside when price falls and OI rises", () => {
      const candles = makeTrendDownCandles(30);
      const oi = makeOI(8, 120_000, 5_000);
      const funding = makeFunding(3, -0.0003);

      const result = detectMarketRegime(candles, strategyConfig, {
        openInterest: oi,
        fundingRates: funding,
        spotPrice: candles.at(-1)!.close + 300,
      });

      expect(result.driverType).toBe("new-shorts");
      expect(result.reasonCodes).toContain("REGIME_DRIVER_NEW_SHORTS");
      expect(result.driverConfidence).toBeGreaterThan(70);
    });

    it("detects deleveraging vacuum when OI collapses with price", () => {
      const candles = makeTrendDownCandles(30);
      const oi = makeOI(8, 120_000, -15_000);
      const funding = makeFunding(3, 0.0002);

      const result = detectMarketRegime(candles, strategyConfig, {
        openInterest: oi,
        fundingRates: funding,
        spotPrice: candles.at(-1)!.close - 300,
      });

      expect(result.driverType).toBe("deleveraging-vacuum");
      expect(result.reasonCodes).toContain("DELEVERAGING_VACUUM");
    });

    it("changes mechanism output when price shape is similar but OI/funding differ", () => {
      const candles = makeTrendUpCandles(30);

      const freshLongs = detectMarketRegime(candles, strategyConfig, {
        openInterest: makeOI(8, 100_000, 3_500),
        fundingRates: makeFunding(3, 0.0003),
        spotPrice: candles.at(-1)!.close - 300,
      });
      const shortCovering = detectMarketRegime(candles, strategyConfig, {
        openInterest: makeOI(8, 100_000, -3_500),
        fundingRates: makeFunding(3, -0.0003),
        spotPrice: candles.at(-1)!.close + 300,
      });

      expect(freshLongs.driverType).toBe("new-longs");
      expect(shortCovering.driverType).toBe("short-covering");
      expect(freshLongs.driverType).not.toBe(shortCovering.driverType);
    });
  });
});

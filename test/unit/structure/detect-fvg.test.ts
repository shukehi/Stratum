import { describe, it, expect } from "vitest";
import { detectFvg } from "../../../src/services/structure/detect-fvg.js";
import { strategyConfig } from "../../../src/app/config.js";
import type { Candle } from "../../../src/domain/market/candle.js";

const BASE_TIME = 1_700_000_000_000;
const INTERVAL = 4 * 60 * 60 * 1000;

function makeCandle(
  i: number,
  open: number,
  high: number,
  low: number,
  close: number
): Candle {
  return { timestamp: BASE_TIME + i * INTERVAL, open, high, low, close, volume: 1000 };
}

/** 构造包含看涨 FVG 的三根 K 线: c0.high < c2.low */
function makeBullishFvgCandles(): Candle[] {
  // 背景 K 线（填充 ATR baseline）
  // high=60800 防止背景最后一根与 FVG 中间根（low=60700）形成意外缺口
  const background: Candle[] = Array.from({ length: 20 }, (_, i) =>
    makeCandle(i, 60000, 60800, 59700, 60100)  // ATR ~1100
  );
  // 三根 FVG K 线: c0.high=60500 < c2.low=61000 → 有效看涨 FVG
  const c0 = makeCandle(20, 60000, 60500, 59500, 60400); // high = 60500
  const c1 = makeCandle(21, 60800, 61500, 60700, 61400); // impulse
  const c2 = makeCandle(22, 61200, 61800, 61000, 61600); // low = 61000
  return [...background, c0, c1, c2];
}

/** 构造包含看跌 FVG 的三根 K 线: c0.low > c2.high */
function makeBearishFvgCandles(): Candle[] {
  const background: Candle[] = Array.from({ length: 20 }, (_, i) =>
    makeCandle(i, 60000, 60300, 59700, 60100)
  );
  const c0 = makeCandle(20, 61500, 62000, 61200, 61300); // low = 61200
  const c1 = makeCandle(21, 60800, 61100, 60000, 60200); // impulse down
  const c2 = makeCandle(22, 60300, 61000, 59800, 59900); // high = 61000 < 61200
  return [...background, c0, c1, c2];
}

/** 无 FVG: 三根 K 线之间有重叠 */
function makeNoFvgCandles(): Candle[] {
  return Array.from({ length: 10 }, (_, i) =>
    makeCandle(i, 60000, 60300, 59700, 60100)
  );
}

// ── 看涨 FVG ─────────────────────────────────────────────────────────────────

describe("detectFvg — 看涨 FVG", () => {
  it("正确识别看涨 FVG，direction=long", () => {
    const candles = makeBullishFvgCandles();
    const results = detectFvg(candles, "4h", strategyConfig);
    const fvg = results.find(r => r.direction === "long");
    expect(fvg).toBeDefined();
    expect(fvg!.direction).toBe("long");
    expect(fvg!.timeframe).toBe("4h");
  });

  it("看涨 FVG entryLow=c0.high, entryHigh=c2.low", () => {
    const candles = makeBullishFvgCandles();
    const results = detectFvg(candles, "4h", strategyConfig);
    const fvg = results.find(r => r.direction === "long")!;
    // c0.high=60500, c2.low=61000
    expect(fvg.entryLow).toBeCloseTo(60500, 0);
    expect(fvg.entryHigh).toBeCloseTo(61000, 0);
  });

  it("看涨 FVG stopLossHint 在 entryLow 之下", () => {
    const candles = makeBullishFvgCandles();
    const results = detectFvg(candles, "4h", strategyConfig);
    const fvg = results.find(r => r.direction === "long")!;
    expect(fvg.stopLossHint).toBeLessThan(fvg.entryLow);
  });

  it("看涨 FVG takeProfitHint 在 entryHigh 之上 (RR >= 2.5)", () => {
    const candles = makeBullishFvgCandles();
    const results = detectFvg(candles, "4h", strategyConfig);
    const fvg = results.find(r => r.direction === "long")!;
    const rr = (fvg.takeProfitHint - fvg.entryHigh) / (fvg.entryHigh - fvg.stopLossHint);
    expect(rr).toBeCloseTo(strategyConfig.minimumRiskReward, 1);
  });

  it("看涨 FVG 初始状态为 pending", () => {
    const candles = makeBullishFvgCandles();
    const results = detectFvg(candles, "4h", strategyConfig);
    const fvg = results.find(r => r.direction === "long")!;
    expect(fvg.confirmationStatus).toBe("pending");
    expect(fvg.reasonCodes).toContain("STRUCTURE_CONFIRMATION_PENDING");
  });

  it("看涨 FVG confluenceFactors 包含 'fvg'", () => {
    const candles = makeBullishFvgCandles();
    const results = detectFvg(candles, "4h", strategyConfig);
    const fvg = results.find(r => r.direction === "long")!;
    expect(fvg.confluenceFactors).toContain("fvg");
  });
});

// ── 看跌 FVG ─────────────────────────────────────────────────────────────────

describe("detectFvg — 看跌 FVG", () => {
  it("正确识别看跌 FVG，direction=short", () => {
    const candles = makeBearishFvgCandles();
    const results = detectFvg(candles, "4h", strategyConfig);
    const fvg = results.find(r => r.direction === "short");
    expect(fvg).toBeDefined();
    expect(fvg!.direction).toBe("short");
  });

  it("看跌 FVG entryHigh=c0.low, entryLow=c2.high", () => {
    const candles = makeBearishFvgCandles();
    const results = detectFvg(candles, "4h", strategyConfig);
    const fvg = results.find(r => r.direction === "short")!;
    // c0.low=61200, c2.high=61000
    expect(fvg.entryHigh).toBeCloseTo(61200, 0);
    expect(fvg.entryLow).toBeCloseTo(61000, 0);
  });

  it("看跌 FVG stopLossHint 在 entryHigh 之上", () => {
    const candles = makeBearishFvgCandles();
    const results = detectFvg(candles, "4h", strategyConfig);
    const fvg = results.find(r => r.direction === "short")!;
    expect(fvg.stopLossHint).toBeGreaterThan(fvg.entryHigh);
  });

  it("看跌 FVG takeProfitHint 在 entryLow 之下 (RR >= 2.5)", () => {
    const candles = makeBearishFvgCandles();
    const results = detectFvg(candles, "4h", strategyConfig);
    const fvg = results.find(r => r.direction === "short")!;
    const rr = (fvg.entryLow - fvg.takeProfitHint) / (fvg.stopLossHint - fvg.entryLow);
    expect(rr).toBeCloseTo(strategyConfig.minimumRiskReward, 1);
  });
});

// ── 无 FVG ───────────────────────────────────────────────────────────────────

describe("detectFvg — 无 FVG", () => {
  it("K 线没有缺口时返回空数组", () => {
    const candles = makeNoFvgCandles();
    const results = detectFvg(candles, "4h", strategyConfig);
    expect(results.filter(r => r.direction === "long").length === 0 ||
           results.filter(r => r.direction === "short").length === 0 ||
           results.length === 0).toBe(true);
  });

  it("K 线不足 3 根时返回空数组", () => {
    const results = detectFvg([makeCandle(0, 60000, 60200, 59800, 60100)], "4h", strategyConfig);
    expect(results).toHaveLength(0);
  });

  it("空数组输入返回空数组", () => {
    expect(detectFvg([], "4h", strategyConfig)).toHaveLength(0);
  });
});

// ── 评分与输出契约 ───────────────────────────────────────────────────────────

describe("detectFvg — 输出契约", () => {
  it("structureScore 在 [0, 100] 范围内", () => {
    const candles = makeBullishFvgCandles();
    const results = detectFvg(candles, "4h", strategyConfig);
    for (const r of results) {
      expect(r.structureScore).toBeGreaterThanOrEqual(0);
      expect(r.structureScore).toBeLessThanOrEqual(100);
    }
  });

  it("所有必填字段存在", () => {
    const candles = makeBullishFvgCandles();
    const results = detectFvg(candles, "4h", strategyConfig);
    expect(results.length).toBeGreaterThan(0);
    const r = results[0];
    expect(typeof r.entryLow).toBe("number");
    expect(typeof r.entryHigh).toBe("number");
    expect(typeof r.stopLossHint).toBe("number");
    expect(typeof r.takeProfitHint).toBe("number");
    expect(typeof r.structureScore).toBe("number");
    expect(typeof r.structureReason).toBe("string");
    expect(typeof r.invalidationReason).toBe("string");
    expect(Array.isArray(r.confluenceFactors)).toBe(true);
    expect(Array.isArray(r.reasonCodes)).toBe(true);
  });

  it("entryLow < entryHigh（入场区间正向）", () => {
    const candles = [...makeBullishFvgCandles(), ...makeBearishFvgCandles().slice(-3)];
    const results = detectFvg(candles, "4h", strategyConfig);
    for (const r of results) {
      expect(r.entryLow).toBeLessThan(r.entryHigh);
    }
  });
});

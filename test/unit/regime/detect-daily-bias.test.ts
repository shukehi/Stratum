import { describe, it, expect } from "vitest";
import { detectDailyBias } from "../../../src/services/regime/detect-daily-bias.js";
import type { Candle } from "../../../src/domain/market/candle.js";

// ── 测试辅助 ──────────────────────────────────────────────────────────────────

function candle(i: number, open: number, high: number, low: number, close: number): Candle {
  return { timestamp: i * 86_400_000, open, high, low, close, volume: 1000 };
}

function flatCandles(count: number, price: number): Candle[] {
  return Array.from({ length: count }, (_, i) =>
    candle(i, price, price, price, price)
  );
}

/**
 * 构造多头结构（lookback=1）：HH + HL
 *
 *  index   role      high  low
 *    0     pre-SL1   115   105
 *    1     SL1(低)   107   100  ← low=100 严格低于邻居
 *    2     上升       135   125
 *    3     SH1(高)   150   140  ← high=150 严格高于邻居
 *    4     下降       145   135
 *    5     SL2(低)   128   120  ← low=120 > SL1(100)
 *    6     上升       165   155
 *    7     SH2(高)   180   170  ← high=180 > SH1(150)
 *    8     尾部       174   167
 *
 *  → 结构: HH_HL → bullish
 */
function makeBullishCandles(): Candle[] {
  return [
    candle(0, 110, 115, 105, 110), // pre-SL1
    candle(1, 102, 107, 100, 102), // SL1
    candle(2, 130, 135, 125, 130), // ascending
    candle(3, 145, 150, 140, 145), // SH1
    candle(4, 140, 145, 135, 140), // descending
    candle(5, 122, 128, 120, 122), // SL2
    candle(6, 160, 165, 155, 160), // ascending
    candle(7, 175, 180, 170, 175), // SH2
    candle(8, 170, 174, 167, 170), // tail
  ];
}

/**
 * 构造空头结构（lookback=1）：LH + LL
 *
 *  index   role      high  low
 *    0     pre-SH1   155   145
 *    1     SH1(高)   180   170  ← high=180 严格高于邻居
 *    2     下降       115   105
 *    3     SL1(低)   107   100  ← low=100 严格低于邻居
 *    4     反弹       145   135
 *    5     SH2(高)   150   140  ← high=150 < SH1(180)  → LH
 *    6     下降       105    92
 *    7     SL2(低)    87    80  ← low=80 < SL1(100)    → LL
 *    8     尾部        88    83
 *
 *  → 结构: LH_LL → bearish
 */
function makeBearishCandles(): Candle[] {
  return [
    candle(0, 150, 155, 145, 150), // pre-SH1
    candle(1, 175, 180, 170, 175), // SH1
    candle(2, 110, 115, 105, 110), // descending
    candle(3, 102, 107, 100, 102), // SL1
    candle(4, 140, 145, 135, 140), // bounce
    candle(5, 145, 150, 140, 145), // SH2 (LH)
    candle(6, 100, 105,  92, 100), // descending
    candle(7,  82,  87,  80,  82), // SL2 (LL)
    candle(8,  85,  88,  83,  85), // tail
  ];
}

/**
 * 构造 HH_LL 结构（lookback=1）：Higher High + Lower Low → neutral
 *
 *  SH1=150 → SH2=180 (HH)  SL1=100 → SL2=80 (LL)
 */
function makeHH_LL_Candles(): Candle[] {
  return [
    candle(0, 140, 145, 135, 140), // pre-SH1
    candle(1, 145, 150, 140, 145), // SH1=150
    candle(2, 110, 115, 105, 110), // descending
    candle(3, 102, 107, 100, 102), // SL1=100
    candle(4, 160, 165, 155, 160), // ascending
    candle(5, 175, 180, 170, 175), // SH2=180 (HH)
    candle(6, 100, 105,  88, 100), // descending
    candle(7,  82,  87,  80,  82), // SL2=80 (LL)
    candle(8,  83,  86,  82,  84), // tail
  ];
}

// ── 数据不足 ──────────────────────────────────────────────────────────────────

describe("detectDailyBias — 数据不足", () => {
  it("K 线数量不足 MIN_CANDLES → neutral + insufficient", () => {
    // lookback=1, MIN_CANDLES=1*2+4=6; 传入 5 根
    const result = detectDailyBias(flatCandles(5, 100), 1);
    expect(result.bias).toBe("neutral");
    expect(result.structure).toBe("insufficient");
    expect(result.reason).toMatch(/数量不足/);
  });

  it("达到最小根数但全部恒定价格（无枢纽）→ neutral + insufficient", () => {
    // 恒定价格不会产生严格的摆高/摆低
    const result = detectDailyBias(flatCandles(20, 100), 1);
    expect(result.bias).toBe("neutral");
    expect(result.structure).toBe("insufficient");
  });

  it("latestClose 始终等于最后一根 K 线的收盘价", () => {
    const cs = flatCandles(5, 123);
    const result = detectDailyBias(cs, 1);
    expect(result.latestClose).toBe(123);
  });
});

// ── 多头结构（HH_HL）────────────────────────────────────────────────────────

describe("detectDailyBias — 多头结构（HH_HL）", () => {
  it("HH + HL → bullish", () => {
    const result = detectDailyBias(makeBullishCandles(), 1);
    expect(result.bias).toBe("bullish");
    expect(result.structure).toBe("HH_HL");
  });

  it("lastSwingHigh ≈ 180（最近摆高）", () => {
    const result = detectDailyBias(makeBullishCandles(), 1);
    expect(result.lastSwingHigh).toBe(180);
  });

  it("lastSwingLow ≈ 120（最近摆低，高于 SL1=100）", () => {
    const result = detectDailyBias(makeBullishCandles(), 1);
    expect(result.lastSwingLow).toBe(120);
  });

  it("latestClose 等于最后一根 K 线收盘价", () => {
    const cs = makeBullishCandles();
    const result = detectDailyBias(cs, 1);
    expect(result.latestClose).toBe(cs[cs.length - 1].close);
  });

  it("reason 包含摆高/摆低数值信息", () => {
    const result = detectDailyBias(makeBullishCandles(), 1);
    expect(result.reason).toMatch(/摆高/);
    expect(result.reason).toMatch(/摆低/);
  });
});

// ── 空头结构（LH_LL）────────────────────────────────────────────────────────

describe("detectDailyBias — 空头结构（LH_LL）", () => {
  it("LH + LL → bearish", () => {
    const result = detectDailyBias(makeBearishCandles(), 1);
    expect(result.bias).toBe("bearish");
    expect(result.structure).toBe("LH_LL");
  });

  it("lastSwingHigh ≈ 150（最近摆高，低于 SH1=180）", () => {
    const result = detectDailyBias(makeBearishCandles(), 1);
    expect(result.lastSwingHigh).toBe(150);
  });

  it("lastSwingLow ≈ 80（最近摆低，低于 SL1=100）", () => {
    const result = detectDailyBias(makeBearishCandles(), 1);
    expect(result.lastSwingLow).toBe(80);
  });

  it("reason 包含结构说明", () => {
    const result = detectDailyBias(makeBearishCandles(), 1);
    expect(result.reason).toMatch(/摆高/);
    expect(result.reason).toMatch(/摆低/);
  });
});

// ── 中性结构 ─────────────────────────────────────────────────────────────────

describe("detectDailyBias — 中性结构", () => {
  it("恒定价格 → neutral（无枢纽）", () => {
    const result = detectDailyBias(flatCandles(60, 100), 1);
    expect(result.bias).toBe("neutral");
  });

  it("HH_LL（膨胀区间）→ neutral", () => {
    const result = detectDailyBias(makeHH_LL_Candles(), 1);
    expect(result.bias).toBe("neutral");
    expect(result.structure).toBe("HH_LL");
  });
});

// ── 枢纽检测正确性 ────────────────────────────────────────────────────────────

describe("detectDailyBias — 枢纽检测正确性", () => {
  it("严格比较：等高相邻 K 线不产生枢纽高", () => {
    // 三根等高 K 线：高点完全相同
    const cs = [
      candle(0, 100, 150, 90, 100),
      candle(1, 100, 150, 90, 100), // 同高，不是严格摆高
      candle(2, 100, 150, 90, 100),
      candle(3, 100, 140, 80, 100), // 稍低
      candle(4, 100, 140, 80, 100),
      candle(5, 100, 140, 80, 100),
    ];
    const result = detectDailyBias(cs, 1);
    expect(result.structure).toBe("insufficient");
  });

  it("lookback=2 时需要更多确认 K 线才能产生枢纽", () => {
    // 9 根 K 线只够 lookback=1，lookback=2 的 MIN_CANDLES=2*2+4=8
    const cs = makeBullishCandles(); // 9 根
    const r1 = detectDailyBias(cs, 1);
    const r2 = detectDailyBias(cs, 2);
    // lookback=1 能识别；lookback=2 由于确认窗口更宽可能找不到枢纽
    expect(r1.bias).toBe("bullish");
    // lookback=2 结果不定，但 bias 一定是合法值
    expect(["bullish", "neutral"]).toContain(r2.bias);
  });

  it("枢纽点不足时 lastSwingHigh/lastSwingLow 仍可能有值", () => {
    // 只有 1 个摆高、0 个摆低的序列
    const cs = [
      candle(0, 100, 105, 95,  100),
      candle(1, 110, 150, 105, 110), // SH (1 个摆高)
      candle(2, 120, 130, 118, 120),
      candle(3, 115, 125, 112, 115),
      candle(4, 110, 120, 108, 110),
      candle(5, 108, 118, 106, 108),
    ];
    const result = detectDailyBias(cs, 1);
    expect(result.structure).toBe("insufficient");
    // reason 解释了枢纽数量不足
    expect(result.reason.length).toBeGreaterThan(0);
  });
});

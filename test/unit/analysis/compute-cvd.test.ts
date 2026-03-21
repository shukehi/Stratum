import { describe, it, expect } from "vitest";
import {
  approxDelta,
  computeCVD,
  detectOrderFlowBias,
} from "../../../src/services/analysis/compute-cvd.js";
import type { Candle } from "../../../src/domain/market/candle.js";

// ── 测试辅助 ──────────────────────────────────────────────────────────────────

function candle(
  ts: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
): Candle {
  return { timestamp: ts * 3_600_000, open, high, low, close, volume };
}

/** 标准阳线：O=100 H=110 L=95 C=108 V=1000 */
const bullCandle = candle(0, 100, 110, 95, 108, 1000);
/** 标准阴线：O=100 H=105 L=90 C=93 V=1000 */
const bearCandle = candle(1, 100, 105, 90, 93, 1000);
/** 十字星：O=100 H=110 L=90 C=100 V=1000 */
const dojiCandle = candle(2, 100, 110, 90, 100, 1000);
/** 零价格区间 */
const flatCandle = candle(3, 100, 100, 100, 100, 1000);
/** 零成交量 */
const zeroVolCandle = candle(4, 95, 110, 90, 108, 0);

// ── approxDelta ───────────────────────────────────────────────────────────────

describe("approxDelta", () => {
  it("阳线返回正 delta（主动买入主导）", () => {
    const d = approxDelta(bullCandle);
    expect(d).toBeGreaterThan(0);
  });

  it("阴线返回负 delta（主动卖出主导）", () => {
    const d = approxDelta(bearCandle);
    expect(d).toBeLessThan(0);
  });

  it("十字星（close = open）返回 0", () => {
    expect(approxDelta(dojiCandle)).toBe(0);
  });

  it("价格区间为零返回 0（避免除以零）", () => {
    expect(approxDelta(flatCandle)).toBe(0);
  });

  it("成交量为零返回 0", () => {
    expect(approxDelta(zeroVolCandle)).toBe(0);
  });

  it("delta 量级 = |(close-open)/(high-low)| × volume", () => {
    // bullCandle: (108-100)/(110-95) × 1000 = 8/15 × 1000 ≈ 533.3
    expect(approxDelta(bullCandle)).toBeCloseTo((108 - 100) / (110 - 95) * 1000, 2);
  });

  it("delta 绝对值 ≤ volume", () => {
    // 由于 |close-open| ≤ high-low，delta ∈ [-volume, +volume]
    expect(Math.abs(approxDelta(bullCandle))).toBeLessThanOrEqual(bullCandle.volume);
    expect(Math.abs(approxDelta(bearCandle))).toBeLessThanOrEqual(bearCandle.volume);
  });
});

// ── computeCVD ────────────────────────────────────────────────────────────────

describe("computeCVD", () => {
  it("空数组返回空数组", () => {
    expect(computeCVD([])).toHaveLength(0);
  });

  it("返回与 candles 等长的序列", () => {
    const cs = [bullCandle, bearCandle, dojiCandle];
    expect(computeCVD(cs)).toHaveLength(3);
  });

  it("第一个元素 cumDelta = delta", () => {
    const result = computeCVD([bullCandle]);
    expect(result[0].cumDelta).toBeCloseTo(result[0].delta, 6);
  });

  it("cumDelta 是 delta 的前缀和", () => {
    const cs = [bullCandle, bearCandle, dojiCandle];
    const result = computeCVD(cs);
    const manualCum = [result[0].delta, result[0].delta + result[1].delta, result[0].delta + result[1].delta + result[2].delta];
    for (let i = 0; i < result.length; i++) {
      expect(result[i].cumDelta).toBeCloseTo(manualCum[i], 6);
    }
  });

  it("timestamp 与 candle 一致", () => {
    const cs = [bullCandle, bearCandle];
    const result = computeCVD(cs);
    expect(result[0].timestamp).toBe(bullCandle.timestamp);
    expect(result[1].timestamp).toBe(bearCandle.timestamp);
  });

  it("全阳线序列 cumDelta 单调递增", () => {
    const cs = Array.from({ length: 5 }, (_, i) => candle(i, 100, 110, 90, 108, 1000));
    const result = computeCVD(cs);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].cumDelta).toBeGreaterThan(result[i - 1].cumDelta);
    }
  });
});

// ── detectOrderFlowBias ───────────────────────────────────────────────────────

describe("detectOrderFlowBias", () => {
  it("空数组返回 neutral", () => {
    const r = detectOrderFlowBias([]);
    expect(r.bias).toBe("neutral");
    expect(r.cvdSlope).toBe(0);
  });

  it("全成交量为零返回 neutral", () => {
    const cs = Array.from({ length: 5 }, (_, i) => candle(i, 95, 110, 90, 108, 0));
    const r = detectOrderFlowBias(cs);
    expect(r.bias).toBe("neutral");
    expect(r.cvdSlope).toBe(0);
  });

  it("主动买入主导 → bullish", () => {
    // 20 根强阳线（全部接近收盘高点）
    const cs = Array.from({ length: 20 }, (_, i) =>
      candle(i, 100, 110, 98, 109, 10_000), // close 很高，delta ≫ 0
    );
    const r = detectOrderFlowBias(cs);
    expect(r.bias).toBe("bullish");
    expect(r.cvdSlope).toBeGreaterThan(0.05);
  });

  it("主动卖出主导 → bearish", () => {
    // 20 根强阴线（全部收盘接近最低点）
    const cs = Array.from({ length: 20 }, (_, i) =>
      candle(i, 100, 102, 90, 91, 10_000), // close 很低，delta ≪ 0
    );
    const r = detectOrderFlowBias(cs);
    expect(r.bias).toBe("bearish");
    expect(r.cvdSlope).toBeLessThan(-0.05);
  });

  it("买卖均衡（十字星）→ neutral", () => {
    // 20 根十字星（close = open），delta = 0
    const cs = Array.from({ length: 20 }, (_, i) =>
      candle(i, 100, 110, 90, 100, 5_000),
    );
    const r = detectOrderFlowBias(cs);
    expect(r.bias).toBe("neutral");
    expect(r.cvdSlope).toBe(0);
  });

  it("cvdSlope 归一化后绝对值 ≤ 1", () => {
    const cs = Array.from({ length: 20 }, (_, i) =>
      candle(i, 90, 110, 90, 110, 5_000), // 极端阳线 delta = volume
    );
    const r = detectOrderFlowBias(cs);
    expect(Math.abs(r.cvdSlope)).toBeLessThanOrEqual(1);
  });

  it("自定义 window 只分析最近 N 根 K 线", () => {
    // 前 15 根阳线 + 后 5 根阴线
    // window=5 应检测到 bearish；window=20 应检测到 bullish 或 neutral
    const cs = [
      ...Array.from({ length: 15 }, (_, i) => candle(i,    100, 110, 98, 109, 10_000)), // 阳线
      ...Array.from({ length: 5 },  (_, i) => candle(i+15, 100, 102, 90,  91, 10_000)), // 阴线
    ];
    const rShort = detectOrderFlowBias(cs, 5);   // 只看最后 5 根阴线
    const rLong  = detectOrderFlowBias(cs, 20);  // 包含 15 根阳线

    expect(rShort.bias).toBe("bearish");
    // 20 根窗口：15根阳+5根阴，净delta应为正 → bullish
    expect(rLong.bias).toBe("bullish");
  });

  it("自定义 neutralThreshold 缩窄中性区间", () => {
    // 十字星 delta = 0，无论阈值多小都应是 neutral
    const cs = Array.from({ length: 10 }, (_, i) =>
      candle(i, 100, 110, 90, 100, 1000),
    );
    expect(detectOrderFlowBias(cs, 10, 0.001).bias).toBe("neutral");
  });

  it("reason 字符串不为空", () => {
    const cs = [bullCandle, bearCandle];
    const r = detectOrderFlowBias(cs);
    expect(r.reason.length).toBeGreaterThan(0);
  });
});

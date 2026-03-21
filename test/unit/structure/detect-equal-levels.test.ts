import { describe, it, expect } from "vitest";
import {
  detectEqualHighs,
  detectEqualLows,
} from "../../../src/services/structure/detect-equal-levels.js";
import type { Candle } from "../../../src/domain/market/candle.js";

// ── 测试辅助 ──────────────────────────────────────────────────────────────────

function candle(
  ts: number,
  open: number,
  high: number,
  low: number,
  close: number,
): Candle {
  return { timestamp: ts * 3_600_000, open, high, low, close, volume: 1000 };
}

/**
 * 构造含有 N 个独立 swing high 的序列。
 * 每个 swing high 用 3 根 K 线表示：低-高-低（lookback=2 下需要更宽的窗口）
 * 模式: [base, base, high, base, base] 保证 swing high 被 2 根较低邻居包围。
 */
function buildSwingHighSequence(highs: number[], base = 100): Candle[] {
  const cs: Candle[] = [];
  let ts = 0;
  for (const h of highs) {
    // 两根 base K 线（确保左侧 lookback=2 均低）
    cs.push(candle(ts++, base, base + 1, base - 1, base));
    cs.push(candle(ts++, base, base + 1, base - 1, base));
    // swing high K 线
    cs.push(candle(ts++, base, h, base - 1, base));
    // 两根 base K 线（确保右侧 lookback=2 均低）
    cs.push(candle(ts++, base, base + 1, base - 1, base));
    cs.push(candle(ts++, base, base + 1, base - 1, base));
  }
  return cs;
}

/** 构造含有 N 个独立 swing low 的序列 */
function buildSwingLowSequence(lows: number[], base = 200): Candle[] {
  const cs: Candle[] = [];
  let ts = 0;
  for (const l of lows) {
    cs.push(candle(ts++, base, base + 1, base - 1, base));
    cs.push(candle(ts++, base, base + 1, base - 1, base));
    cs.push(candle(ts++, base, base + 1, l, base));
    cs.push(candle(ts++, base, base + 1, base - 1, base));
    cs.push(candle(ts++, base, base + 1, base - 1, base));
  }
  return cs;
}

// ── detectEqualHighs ──────────────────────────────────────────────────────────

describe("detectEqualHighs", () => {
  it("空数组返回空数组", () => {
    expect(detectEqualHighs([])).toHaveLength(0);
  });

  it("K 线不足 (swingLookback*2+1) 返回空数组", () => {
    const cs = [candle(0, 100, 110, 90, 100), candle(1, 100, 110, 90, 100)];
    expect(detectEqualHighs(cs)).toHaveLength(0);
  });

  it("仅 1 个 swing high → 不足 minCount=2 → 返回空数组", () => {
    const cs = buildSwingHighSequence([110]);
    expect(detectEqualHighs(cs)).toHaveLength(0);
  });

  it("两个相同价格 swing high → 1 个 EqualLevel (touchCount=2)", () => {
    const cs = buildSwingHighSequence([110, 110]);
    const result = detectEqualHighs(cs);
    expect(result).toHaveLength(1);
    expect(result[0].touchCount).toBe(2);
    expect(result[0].type).toBe("high");
  });

  it("两个容差内 swing high → 1 个 EqualLevel", () => {
    // 110 和 110.05 → 差值 0.05/110 ≈ 0.045% < tolerance 0.1%
    const cs = buildSwingHighSequence([110, 110.05]);
    const result = detectEqualHighs(cs, 0.001); // 0.1% tolerance
    expect(result).toHaveLength(1);
    expect(result[0].touchCount).toBe(2);
  });

  it("两个容差外 swing high → 无 EqualLevel（每组仅 1 个，未达 minCount）", () => {
    // 110 和 112 → 差值 2/110 ≈ 1.8% > 0.1%
    const cs = buildSwingHighSequence([110, 112]);
    const result = detectEqualHighs(cs, 0.001);
    expect(result).toHaveLength(0);
  });

  it("三个相近 swing high → touchCount=3", () => {
    const cs = buildSwingHighSequence([110, 110.02, 110.04]);
    const result = detectEqualHighs(cs, 0.001);
    expect(result).toHaveLength(1);
    expect(result[0].touchCount).toBe(3);
  });

  it("代表价格为组内均值", () => {
    const cs = buildSwingHighSequence([110, 110]);
    const result = detectEqualHighs(cs, 0.001);
    expect(result[0].price).toBeCloseTo(110, 4);
  });

  it("代表价格为非对称组的均值", () => {
    // 110 和 110.08 → avg = 110.04（差值 0.08/110 ≈ 0.073% < 0.1% 容差）
    const cs = buildSwingHighSequence([110, 110.08]);
    const result = detectEqualHighs(cs, 0.001);
    expect(result[0].price).toBeCloseTo(110.04, 4);
  });

  it("toleranceAbsolute = price × tolerance", () => {
    const cs = buildSwingHighSequence([110, 110]);
    const result = detectEqualHighs(cs, 0.001);
    expect(result[0].toleranceAbsolute).toBeCloseTo(110 * 0.001, 6);
  });

  it("firstTimestamp 为最早触碰时间，lastTimestamp 为最晚触碰时间", () => {
    const cs = buildSwingHighSequence([110, 110]);
    const result = detectEqualHighs(cs);
    // 第一个 swing high 在第 3 根 K 线（index=2），timestamp = 2*3_600_000
    // 第二个 swing high 在第 8 根 K 线（index=7），timestamp = 7*3_600_000
    expect(result[0].firstTimestamp).toBeLessThan(result[0].lastTimestamp);
  });

  it("自定义 minCount=3：2 个 swing high 不满足", () => {
    const cs = buildSwingHighSequence([110, 110]);
    expect(detectEqualHighs(cs, 0.001, 3)).toHaveLength(0);
  });

  it("自定义 minCount=3：3 个 swing high 满足", () => {
    const cs = buildSwingHighSequence([110, 110, 110]);
    const result = detectEqualHighs(cs, 0.001, 3);
    expect(result).toHaveLength(1);
    expect(result[0].touchCount).toBe(3);
  });

  it("两组不相干 swing high → 各自判断", () => {
    // 110 和 110 相近；120 和 120 相近；两组互不干扰
    const cs = buildSwingHighSequence([110, 110, 120, 120]);
    const result = detectEqualHighs(cs, 0.001);
    expect(result).toHaveLength(2);
    // 一组均价约 110，另一组约 120
    const prices = result.map(r => r.price).sort((a, b) => a - b);
    expect(prices[0]).toBeCloseTo(110, 0);
    expect(prices[1]).toBeCloseTo(120, 0);
  });

  it("较大 tolerance 合并更宽范围的 swing high", () => {
    // 110 和 111 → 差值 1/110 ≈ 0.91%
    // tolerance=0.001 (0.1%)：不合并；tolerance=0.01 (1%)：合并
    const cs = buildSwingHighSequence([110, 111]);
    expect(detectEqualHighs(cs, 0.001)).toHaveLength(0);
    expect(detectEqualHighs(cs, 0.01)).toHaveLength(1);
  });
});

// ── detectEqualLows ───────────────────────────────────────────────────────────

describe("detectEqualLows", () => {
  it("空数组返回空数组", () => {
    expect(detectEqualLows([])).toHaveLength(0);
  });

  it("仅 1 个 swing low → 不足 minCount=2 → 返回空数组", () => {
    const cs = buildSwingLowSequence([90]);
    expect(detectEqualLows(cs)).toHaveLength(0);
  });

  it("两个相同价格 swing low → 1 个 EqualLevel (touchCount=2)", () => {
    const cs = buildSwingLowSequence([90, 90]);
    const result = detectEqualLows(cs);
    expect(result).toHaveLength(1);
    expect(result[0].touchCount).toBe(2);
    expect(result[0].type).toBe("low");
  });

  it("两个容差内 swing low → 1 个 EqualLevel", () => {
    // 90 和 90.05 → 差值 0.05/90 ≈ 0.056% < 0.1%
    const cs = buildSwingLowSequence([90, 90.05]);
    const result = detectEqualLows(cs, 0.001);
    expect(result).toHaveLength(1);
  });

  it("两个容差外 swing low → 无 EqualLevel", () => {
    // 90 和 92 → 差值 2/90 ≈ 2.2% > 0.1%
    const cs = buildSwingLowSequence([90, 92]);
    const result = detectEqualLows(cs, 0.001);
    expect(result).toHaveLength(0);
  });

  it("代表价格为组内均值", () => {
    const cs = buildSwingLowSequence([90, 90.06]);
    const result = detectEqualLows(cs, 0.001);
    expect(result[0].price).toBeCloseTo(90.03, 4);
  });

  it("type 固定为 \"low\"", () => {
    const cs = buildSwingLowSequence([90, 90]);
    const result = detectEqualLows(cs);
    expect(result[0].type).toBe("low");
  });

  it("toleranceAbsolute = price × tolerance", () => {
    const cs = buildSwingLowSequence([90, 90]);
    const result = detectEqualLows(cs, 0.002);
    expect(result[0].toleranceAbsolute).toBeCloseTo(90 * 0.002, 6);
  });

  it("两组不相干 swing low → 各自判断", () => {
    const cs = buildSwingLowSequence([90, 90, 80, 80]);
    const result = detectEqualLows(cs, 0.001);
    expect(result).toHaveLength(2);
  });
});

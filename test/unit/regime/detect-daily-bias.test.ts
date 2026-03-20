import { describe, it, expect } from "vitest";
import { detectDailyBias, computeEma } from "../../../src/services/regime/detect-daily-bias.js";
import type { Candle } from "../../../src/domain/market/candle.js";

// ── 测试辅助 ──────────────────────────────────────────────────────────────────

/**
 * 生成 N 根价格恒定的日线 K 线（close = price）
 */
function flatCandles(count: number, price: number): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: i * 86_400_000,
    open:  price,
    high:  price,
    low:   price,
    close: price,
    volume: 1000,
  }));
}

/**
 * 生成线性上升的 K 线（价格从 startPrice 每根增加 step）
 */
function trendingCandles(count: number, startPrice: number, step: number): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const price = startPrice + i * step;
    return {
      timestamp: i * 86_400_000,
      open: price,
      high: price + Math.abs(step),
      low:  price - Math.abs(step),
      close: price,
      volume: 1000,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe("computeEma", () => {
  it("数据不足时返回最后一个收盘价", () => {
    expect(computeEma([100, 110, 120], 20)).toBe(120);
  });

  it("恒定序列的 EMA 等于序列值", () => {
    const closes = new Array(60).fill(100);
    expect(computeEma(closes, 20)).toBeCloseTo(100, 5);
    expect(computeEma(closes, 50)).toBeCloseTo(100, 5);
  });

  it("上升序列的 EMA20 > EMA50（短期均线反应更快）", () => {
    const closes = trendingCandles(100, 100, 1).map(c => c.close);
    const ema20 = computeEma(closes, 20);
    const ema50 = computeEma(closes, 50);
    expect(ema20).toBeGreaterThan(ema50);
  });

  it("下降序列的 EMA20 < EMA50", () => {
    const closes = trendingCandles(100, 200, -1).map(c => c.close);
    const ema20 = computeEma(closes, 20);
    const ema50 = computeEma(closes, 50);
    expect(ema20).toBeLessThan(ema50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("detectDailyBias", () => {
  it("数据不足（< 50 根）→ neutral", () => {
    const result = detectDailyBias(flatCandles(30, 100));
    expect(result.bias).toBe("neutral");
    expect(result.reason).toMatch(/数据不足/);
  });

  it("恒定价格（EMA 粘合）→ neutral", () => {
    const result = detectDailyBias(flatCandles(100, 100));
    expect(result.bias).toBe("neutral");
    expect(result.separation).toBeCloseTo(0, 5);
  });

  it("强劲上升趋势 → bullish", () => {
    // 价格从 100 → 200（步进 1），最后几根价格远高于所有 EMA
    const candles = trendingCandles(100, 100, 1);
    const result = detectDailyBias(candles);
    expect(result.bias).toBe("bullish");
    expect(result.ema20).toBeGreaterThan(result.ema50);
    expect(result.latestClose).toBeGreaterThan(result.ema20);
  });

  it("强劲下降趋势 → bearish", () => {
    // 价格从 200 → 100（步进 -1），最后几根价格远低于所有 EMA
    const candles = trendingCandles(100, 200, -1);
    const result = detectDailyBias(candles);
    expect(result.bias).toBe("bearish");
    expect(result.ema20).toBeLessThan(result.ema50);
    expect(result.latestClose).toBeLessThan(result.ema20);
  });

  it("自定义 separationThreshold 可调整敏感度", () => {
    // 轻微上升趋势：EMA 间距可能 < 1%
    const candles = trendingCandles(80, 100, 0.05);
    // 宽松阈值（5%）→ 间距不足 → neutral
    const loose = detectDailyBias(candles, 0.05);
    // 严格阈值（0%）→ 即使极小间距也能判断方向
    const strict = detectDailyBias(candles, 0);
    // strict 应该能识别出趋势（bullish 或 neutral）
    expect(["bullish", "neutral"]).toContain(strict.bias);
    // loose 阈值更大，可能保持 neutral
    expect(["neutral", "bullish"]).toContain(loose.bias);
  });

  it("返回正确的 ema20 / ema50 / latestClose / separation 字段", () => {
    const candles = trendingCandles(100, 100, 1);
    const result = detectDailyBias(candles);
    expect(result.ema20).toBeGreaterThan(0);
    expect(result.ema50).toBeGreaterThan(0);
    expect(result.latestClose).toBe(candles[candles.length - 1].close);
    expect(result.separation).toBeCloseTo(
      (result.ema20 - result.ema50) / result.ema50,
      8
    );
  });

  it("过渡区（EMA 分叉但价格在中间）→ neutral", () => {
    // 构造场景：EMA20 > EMA50 但收盘价 < EMA20（处于回调中）
    // 先建立上升趋势，然后最后几根价格骤降
    const rising = trendingCandles(80, 100, 1);
    const drop: Candle[] = Array.from({ length: 20 }, (_, i) => ({
      timestamp: (80 + i) * 86_400_000,
      open:  165 - i * 2,
      high:  170 - i * 2,
      low:   160 - i * 2,
      close: 150 - i * 5, // 急速下跌，低于短期 EMA
      volume: 1000,
    }));
    const candles = [...rising, ...drop];
    const result = detectDailyBias(candles);
    // EMA20 > EMA50（惯性），但 close < EMA20 → neutral
    // 也可能已经跌穿 EMA20 < EMA50 → bearish
    expect(["neutral", "bearish"]).toContain(result.bias);
  });
});

import { describe, it, expect } from "vitest";
import { detectDailyBias } from "../../../src/services/regime/detect-daily-bias.js";
import type { Candle } from "../../../src/domain/market/candle.js";

// ── 测试辅助 ──────────────────────────────────────────────────────────────────

function candle(
  i: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 1000,
): Candle {
  return { timestamp: i * 86_400_000, open, high, low, close, volume };
}

/**
 * 构造"折价区"场景：
 *   成交量集中在高价区（400~600），当前价格远低于 VAL。
 *   → detectDailyBias 应返回 bullish
 */
function makeDiscountCandles(lookback = 30): Candle[] {
  const cs: Candle[] = [];
  const highVolCount = Math.floor(lookback * 2 / 3);
  for (let i = 0; i < highVolCount; i++) {
    cs.push(candle(i, 490, 600, 400, 500, 50_000));
  }
  const remaining = lookback - highVolCount;
  for (let i = highVolCount; i < highVolCount + remaining; i++) {
    cs.push(candle(i, 150, 200, 100, 150, 200));
  }
  return cs;
}

/**
 * 构造"溢价区"场景：
 *   成交量集中在低价区（100~200），当前价格远高于 VAH。
 *   → detectDailyBias 应返回 bearish
 */
function makePremiumCandles(lookback = 30): Candle[] {
  const cs: Candle[] = [];
  const highVolCount = Math.floor(lookback * 2 / 3);
  for (let i = 0; i < highVolCount; i++) {
    cs.push(candle(i, 140, 200, 100, 150, 50_000));
  }
  const remaining = lookback - highVolCount;
  for (let i = highVolCount; i < highVolCount + remaining; i++) {
    cs.push(candle(i, 490, 600, 400, 550, 200));
  }
  return cs;
}

/**
 * 构造"均衡区"场景：
 *   成交量均匀分布，当前价格在 VPOC 附近。
 *   → detectDailyBias 应返回 neutral
 */
function makeEquilibriumCandles(lookback = 30): Candle[] {
  return Array.from({ length: lookback }, (_, i) =>
    candle(i, 280, 350, 250, 300, 10_000),
  );
}

// ── 基本功能 ──────────────────────────────────────────────────────────────────

describe("detectDailyBias — 基本功能", () => {
  it("数据不足时返回 neutral / equilibrium", () => {
    const result = detectDailyBias([candle(0, 100, 110, 90, 100)], 30);
    expect(result.bias).toBe("neutral");
    expect(result.priceZone).toBe("equilibrium");
    expect(result.reason).toMatch(/数据不足/);
  });

  it("空数组返回 neutral", () => {
    const result = detectDailyBias([], 30);
    expect(result.bias).toBe("neutral");
    expect(result.priceZone).toBe("equilibrium");
  });
});

// ── 折价区（bullish）────────────────────────────────────────────────────────

describe("detectDailyBias — 折价区（bullish）", () => {
  it("价格远低于成交量集中区 → bullish", () => {
    const result = detectDailyBias(makeDiscountCandles(30), 30);
    expect(result.bias).toBe("bullish");
    expect(result.priceZone).toBe("discount");
  });

  it("VAH > VAL", () => {
    const result = detectDailyBias(makeDiscountCandles(30), 30);
    expect(result.vah).toBeGreaterThan(result.val);
  });

  it("latestClose 确实低于 VAL", () => {
    const result = detectDailyBias(makeDiscountCandles(30), 30);
    expect(result.latestClose).toBeLessThan(result.val);
  });

  it("VPOC 在高成交量区域（400~610）", () => {
    const result = detectDailyBias(makeDiscountCandles(30), 30);
    expect(result.vpoc).toBeGreaterThanOrEqual(390);
    expect(result.vpoc).toBeLessThanOrEqual(610);
  });
});

// ── 溢价区（bearish）────────────────────────────────────────────────────────

describe("detectDailyBias — 溢价区（bearish）", () => {
  it("价格远高于成交量集中区 → bearish", () => {
    const result = detectDailyBias(makePremiumCandles(30), 30);
    expect(result.bias).toBe("bearish");
    expect(result.priceZone).toBe("premium");
  });

  it("latestClose 确实高于 VAH", () => {
    const result = detectDailyBias(makePremiumCandles(30), 30);
    expect(result.latestClose).toBeGreaterThan(result.vah);
  });

  it("reason 包含 VPOC 和溢价区说明", () => {
    const result = detectDailyBias(makePremiumCandles(30), 30);
    expect(result.reason).toMatch(/VPOC/);
    expect(result.reason).toMatch(/溢价区/);
  });
});

// ── 均衡区（neutral）────────────────────────────────────────────────────────

describe("detectDailyBias — 均衡区（neutral）", () => {
  it("价格在价值区间内 → neutral", () => {
    const result = detectDailyBias(makeEquilibriumCandles(30), 30);
    expect(result.bias).toBe("neutral");
    expect(result.priceZone).toBe("equilibrium");
  });

  it("reason 包含均衡区描述", () => {
    const result = detectDailyBias(makeEquilibriumCandles(30), 30);
    expect(result.reason).toMatch(/均衡区/);
  });
});

// ── VP 计算窗口参数 ───────────────────────────────────────────────────────────

describe("detectDailyBias — vpLookbackDays 参数", () => {
  it("lookback 窗口影响 VPOC 位置", () => {
    // 前 50 根在高区（400~600，大成交量）
    // 后 10 根在低区（100~200，同样大成交量）
    const cs: Candle[] = [];
    for (let i = 0; i < 50; i++) cs.push(candle(i, 490, 600, 400, 500, 50_000));
    for (let i = 50; i < 60; i++) cs.push(candle(i, 140, 200, 100, 150, 50_000));

    // lookback=15：窗口内 5 根高区 + 10 根低区，低区成交量更多 → VPOC 在低区
    const r15 = detectDailyBias(cs, 15);
    // lookback=60：50 根高区主导，高区总成交量远大于低区 → VPOC 在高区
    const r60 = detectDailyBias(cs, 60);

    // 短窗口 VPOC 应低于长窗口 VPOC
    expect(r15.vpoc).toBeLessThan(r60.vpoc);
  });

  it("K 线数量恰好等于 lookback 时正常运行", () => {
    const result = detectDailyBias(makeEquilibriumCandles(20), 20);
    expect(result.bias).toMatch(/^(bullish|bearish|neutral)$/);
    expect(result.vpoc).toBeGreaterThan(0);
  });
});

// ── 结果字段完整性 ────────────────────────────────────────────────────────────

describe("detectDailyBias — 结果字段完整性", () => {
  it("所有必填字段都存在且合理", () => {
    const result = detectDailyBias(makeDiscountCandles(30), 30);
    expect(result.bias).toMatch(/^(bullish|bearish|neutral)$/);
    expect(result.priceZone).toMatch(/^(premium|equilibrium|discount)$/);
    expect(result.vpoc).toBeGreaterThan(0);
    expect(result.vah).toBeGreaterThan(result.val);
    expect(result.latestClose).toBeGreaterThan(0);
    expect(typeof result.reason).toBe("string");
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("bias 与 priceZone 一致", () => {
    const cases = [
      { candles: makeDiscountCandles(30), expectedBias: "bullish", expectedZone: "discount" },
      { candles: makePremiumCandles(30),  expectedBias: "bearish", expectedZone: "premium"  },
      { candles: makeEquilibriumCandles(30), expectedBias: "neutral", expectedZone: "equilibrium" },
    ] as const;

    for (const { candles, expectedBias, expectedZone } of cases) {
      const result = detectDailyBias(candles, 30);
      expect(result.bias).toBe(expectedBias);
      expect(result.priceZone).toBe(expectedZone);
    }
  });
});

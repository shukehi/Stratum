import { describe, it, expect } from "vitest";
import {
  computeVolumeProfile,
  getPriceZone,
  nearestHVN,
  nearestLVN,
} from "../../../src/services/analysis/compute-vp.js";
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
  return { timestamp: ts * 86_400_000, open, high, low, close, volume };
}

/**
 * 构造"集中成交区"测试数据：
 *   前 N 根 K 线价格集中在低区（low_range），成交量大
 *   后 N 根 K 线价格在高区（high_range），成交量小
 *   → VPOC 应在低区，VAH 应小于高区
 */
function makeConcentratedCandles(): Candle[] {
  const candles: Candle[] = [];
  // 20 根在低区（90~110），大成交量
  for (let i = 0; i < 20; i++) {
    candles.push(candle(i, 95, 110, 90, 100, 10_000));
  }
  // 10 根在高区（190~210），小成交量
  for (let i = 20; i < 30; i++) {
    candles.push(candle(i, 195, 210, 190, 200, 500));
  }
  return candles;
}

/** 全部 K 线在同一价格（极端情况：价格区间为零）*/
function makeFlatCandles(count: number, price: number): Candle[] {
  return Array.from({ length: count }, (_, i) =>
    candle(i, price, price, price, price, 1000),
  );
}

// ── computeVolumeProfile ──────────────────────────────────────────────────────

describe("computeVolumeProfile", () => {
  it("空数组返回 null", () => {
    expect(computeVolumeProfile([])).toBeNull();
  });

  it("价格区间为零返回 null", () => {
    expect(computeVolumeProfile(makeFlatCandles(10, 100))).toBeNull();
  });

  it("VPOC 在高成交量价格区域内", () => {
    const vp = computeVolumeProfile(makeConcentratedCandles());
    expect(vp).not.toBeNull();
    // 低区成交量远大于高区，VPOC 应在 90~110 之间
    expect(vp!.vpoc).toBeGreaterThanOrEqual(90);
    expect(vp!.vpoc).toBeLessThanOrEqual(115);
  });

  it("priceMin / priceMax 覆盖所有 K 线区间", () => {
    const cs = makeConcentratedCandles();
    const vp = computeVolumeProfile(cs)!;
    const allLows  = cs.map(c => c.low);
    const allHighs = cs.map(c => c.high);
    expect(vp.priceMin).toBeCloseTo(Math.min(...allLows),  1);
    expect(vp.priceMax).toBeCloseTo(Math.max(...allHighs), 1);
  });

  it("总成交量 = 所有 K 线成交量之和", () => {
    const cs = makeConcentratedCandles();
    const expectedTotal = cs.reduce((s, c) => s + c.volume, 0);
    const vp = computeVolumeProfile(cs)!;
    // 浮点误差允许 0.1%
    expect(vp.totalVolume).toBeCloseTo(expectedTotal, -2);
  });

  it("VAH > VPOC > VAL", () => {
    const vp = computeVolumeProfile(makeConcentratedCandles())!;
    expect(vp.vah).toBeGreaterThan(vp.vpoc);
    expect(vp.vpoc).toBeGreaterThan(vp.val);
  });

  it("价值区间覆盖目标比例（70%）的成交量", () => {
    const cs = makeConcentratedCandles();
    const vp = computeVolumeProfile(cs, { valueAreaPercent: 0.70 })!;
    // 落在 VAL~VAH 内的桶累计成交量 >= 70%
    const inArea = vp.buckets
      .filter(b => b.priceMid >= vp.val && b.priceMid <= vp.vah)
      .reduce((s, b) => s + b.volume, 0);
    expect(inArea / vp.totalVolume).toBeGreaterThanOrEqual(0.70);
  });

  it("自定义 valueAreaPercent = 0.50 时，价值区间缩小", () => {
    const cs = makeConcentratedCandles();
    const vp70 = computeVolumeProfile(cs, { valueAreaPercent: 0.70 })!;
    const vp50 = computeVolumeProfile(cs, { valueAreaPercent: 0.50 })!;
    const range70 = vp70.vah - vp70.val;
    const range50 = vp50.vah - vp50.val;
    expect(range50).toBeLessThanOrEqual(range70);
  });

  it("自定义 bucketCount 正常运行", () => {
    const vp = computeVolumeProfile(makeConcentratedCandles(), { bucketCount: 50 });
    expect(vp).not.toBeNull();
    expect(vp!.buckets).toHaveLength(50);
  });

  it("所有桶的成交量 >= 0", () => {
    const vp = computeVolumeProfile(makeConcentratedCandles())!;
    for (const b of vp.buckets) {
      expect(b.volume).toBeGreaterThanOrEqual(0);
    }
  });

  it("HVN 列表中每个价格都在区间范围内", () => {
    const vp = computeVolumeProfile(makeConcentratedCandles())!;
    for (const price of vp.hvn) {
      expect(price).toBeGreaterThanOrEqual(vp.priceMin);
      expect(price).toBeLessThanOrEqual(vp.priceMax);
    }
  });

  it("LVN 列表中每个价格都在区间范围内", () => {
    const vp = computeVolumeProfile(makeConcentratedCandles())!;
    for (const price of vp.lvn) {
      expect(price).toBeGreaterThanOrEqual(vp.priceMin);
      expect(price).toBeLessThanOrEqual(vp.priceMax);
    }
  });

  it("单根 K 线也能正常计算", () => {
    const vp = computeVolumeProfile([candle(0, 100, 110, 90, 105, 5000)]);
    expect(vp).not.toBeNull();
    expect(vp!.vpoc).toBeGreaterThanOrEqual(90);
    expect(vp!.vpoc).toBeLessThanOrEqual(110);
  });
});

// ── getPriceZone ──────────────────────────────────────────────────────────────

describe("getPriceZone", () => {
  const vah = 110;
  const val = 90;

  it("close > VAH → premium", () => {
    expect(getPriceZone(120, vah, val)).toBe("premium");
  });

  it("close < VAL → discount", () => {
    expect(getPriceZone(80, vah, val)).toBe("discount");
  });

  it("close = VAH → equilibrium（边界）", () => {
    expect(getPriceZone(110, vah, val)).toBe("equilibrium");
  });

  it("close = VAL → equilibrium（边界）", () => {
    expect(getPriceZone(90, vah, val)).toBe("equilibrium");
  });

  it("close 在 VAL~VAH 之间 → equilibrium", () => {
    expect(getPriceZone(100, vah, val)).toBe("equilibrium");
  });

  it("close 远高于 VAH → premium", () => {
    expect(getPriceZone(200, vah, val)).toBe("premium");
  });
});

// ── nearestHVN / nearestLVN ───────────────────────────────────────────────────

describe("nearestHVN", () => {
  it("空列表返回 null", () => {
    expect(nearestHVN(100, [])).toBeNull();
  });

  it("返回距离最近的 HVN", () => {
    expect(nearestHVN(105, [90, 110, 130])).toBe(110);
    expect(nearestHVN(95,  [90, 110, 130])).toBe(90);
  });

  it("单个元素直接返回", () => {
    expect(nearestHVN(200, [100])).toBe(100);
  });
});

describe("nearestLVN", () => {
  it("空列表返回 null", () => {
    expect(nearestLVN(100, [])).toBeNull();
  });

  it("返回距离最近的 LVN", () => {
    expect(nearestLVN(102, [95, 108, 120])).toBe(108);
  });
});

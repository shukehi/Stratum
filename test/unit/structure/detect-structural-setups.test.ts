import { describe, it, expect } from "vitest";
import { detectLiquiditySweep } from "../../../src/services/structure/detect-liquidity-sweep.js";
import { strategyConfig } from "../../../src/app/config.js";
import type { Candle } from "../../../src/domain/market/candle.js";
import type { OpenInterestPoint } from "../../../src/domain/market/open-interest.js";

function makeCandles(count: number, basePrice: number): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < count; i++) {
    candles.push({
      timestamp: i * 3600000,
      open: basePrice,
      high: basePrice + 100,
      low: basePrice - 100,
      close: basePrice,
      volume: 1000,
    });
  }
  return candles;
}

// 制造一个符合 3-Sigma 坍缩的 OI 序列
function makeCrashOI(count: number, crashIndex: number): OpenInterestPoint[] {
  const points: OpenInterestPoint[] = [];
  const baseOI = 1000000;
  // 前面的点保持稳定以降低标准差
  for (let i = 0; i < count - 1; i++) {
    points.push({ timestamp: i, openInterest: baseOI + (Math.random() * 100) });
  }
  // 最后一个点发生剧烈坍缩
  points.push({ timestamp: count, openInterest: baseOI * 0.90 }); // -10% 坍缩，绝对触发 3-Sigma
  return points;
}

describe("detectLiquiditySweep (V3 Physics Refactor)", () => {
  it("物理验证通过：刺破 swing low + 3-Sigma OI 坍缩 -> 生成看涨 setup", () => {
    const candles = makeCandles(20, 60000);
    // 在中间造一个 swing low
    candles[10].low = 59000;
    // 最后一根 K 线刺破它并收回
    const lastIdx = candles.length - 1;
    candles[lastIdx].low = 58500;
    candles[lastIdx].close = 59500;

    const oi = makeCrashOI(50, -5); // 50个点，最后大跌
    const results = detectLiquiditySweep(candles, strategyConfig, oi);

    expect(results).toHaveLength(1);
    expect(results[0].direction).toBe("long");
    expect(results[0].structureReason).toContain("物理确认");
  });

  it("物理验证失败：有价格刺破但没有 OI 坍缩 -> 过滤信号", () => {
    const candles = makeCandles(20, 60000);
    candles[10].low = 59000;
    const lastIdx = candles.length - 1;
    candles[lastIdx].low = 58500;
    candles[lastIdx].close = 59500;

    // OI 保持平稳，无坍缩
    const oi = makeCandles(50, 1000000).map(c => ({ timestamp: c.timestamp, openInterest: c.close }));
    
    const results = detectLiquiditySweep(candles, strategyConfig, oi);
    expect(results).toHaveLength(0);
  });
});

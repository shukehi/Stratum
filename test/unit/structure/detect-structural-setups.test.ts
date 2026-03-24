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
  // 前面的点保持稳定以降低标准差，但要给出足够噪声避免 Sigma 被无限放大
  for (let i = 0; i < count - 1; i++) {
    points.push({ timestamp: i, openInterest: baseOI + (Math.random() * 86000) });
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

  it("CVD 加速度接入：同等 sweep 条件下，CVD bullish 会比 bearish 多出至少 10 分结构分 (看涨 Sweep)", () => {
    const candlesBullish = makeCandles(20, 60000);
    const candlesBearish = makeCandles(20, 60000);
    
    // 中间造一个 swing low
    candlesBullish[10].low = 59000;
    candlesBearish[10].low = 59000;

    // 最后一根刺破并收回，但深度控制在很小范围，避免 score 被 clamp 满分 100
    candlesBullish[19].low = 58950; candlesBullish[19].close = 59500;
    candlesBearish[19].low = 58950; candlesBearish[19].close = 59500;

    // 前段 16 根全部 neutral。
    // 为了拉开 CVD gap，最后 3 根 K 线，
    // bullish：连续大阳线 (close > open, 大 volume)
    // bearish：连续大阴线 (close < open, 大 volume - 注意最后一根需要收回)
    for(let i=16; i<19; i++) {
        candlesBullish[i].open = 59000; candlesBullish[i].close = 59500; candlesBullish[i].volume = 10000; // 强买
        candlesBearish[i].open = 59500; candlesBearish[i].close = 59000; candlesBearish[i].volume = 10000; // 强卖
    }
    
    // 确保最后一根有同等大 volume，但是 close > open
    candlesBullish[19].open = 58800; candlesBullish[19].volume = 10000;
    candlesBearish[19].open = 58800; candlesBearish[19].volume = 1000; // bearish 让这根买盘很小，避免破坏整体 bearish 加速

    // 降低 momentumBonus 以防分数超过 100 被 clamp
    const oi = makeCrashOI(50, -3.1); 

    const resBullish = detectLiquiditySweep(candlesBullish, strategyConfig, oi);
    const resBearish = detectLiquiditySweep(candlesBearish, strategyConfig, oi);

    expect(resBullish).toHaveLength(1);
    expect(resBearish).toHaveLength(1);

    // bullish 应该至少等于 bearish + 10 分
    expect(resBullish[0].structureScore).toBeGreaterThanOrEqual(resBearish[0].structureScore + 10);
  });
});

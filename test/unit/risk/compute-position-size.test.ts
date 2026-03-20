import { describe, it, expect } from "vitest";
import { computePositionSize } from "../../../src/services/risk/compute-position-size.js";
import { strategyConfig } from "../../../src/app/config.js";

// strategyConfig.riskPerTrade = 0.01 (1%)

describe("computePositionSize — 基础公式", () => {
  it("标准仓位计算: $100k 账户, 1% 风险, entry=60000, stop=58800", () => {
    // riskAmount = 100000 × 0.01 = 1000
    // stopDistance = |60000 - 58800| = 1200
    // positionSize_quote = 1000 × 60000 / 1200 = 50000
    const result = computePositionSize(100_000, 60000, 58800, strategyConfig);
    expect(result).toBeCloseTo(50_000, 2);
  });

  it("做空方向: entry=60000, stop=61200（止损在上方）", () => {
    // stopDistance = |60000 - 61200| = 1200（相同距离，相同结果）
    const result = computePositionSize(100_000, 60000, 61200, strategyConfig);
    expect(result).toBeCloseTo(50_000, 2);
  });

  it("较宽止损: entry=60000, stop=56000 → 仓位更小", () => {
    // stopDistance = 4000; positionSize = 1000 × 60000 / 4000 = 15000
    const result = computePositionSize(100_000, 60000, 56000, strategyConfig);
    expect(result).toBeCloseTo(15_000, 2);
  });

  it("较窄止损: entry=60000, stop=59700 → 仓位更大", () => {
    // stopDistance = 300; positionSize = 1000 × 60000 / 300 = 200000
    const result = computePositionSize(100_000, 60000, 59700, strategyConfig);
    expect(result).toBeCloseTo(200_000, 2);
  });

  it("更大账户: $500k, 相同比例风险 → 仓位成比例放大", () => {
    // riskAmount = 5000; stopDistance = 1200; positionSize = 5000 × 60000 / 1200 = 250000
    const result = computePositionSize(500_000, 60000, 58800, strategyConfig);
    expect(result).toBeCloseTo(250_000, 2);
  });

  it("riskPerTrade 来自 config: 验证 strategyConfig.riskPerTrade=0.01", () => {
    // 覆盖 config 中的 riskPerTrade
    const config = { ...strategyConfig, riskPerTrade: 0.02 };
    // riskAmount = 100000 × 0.02 = 2000; positionSize = 2000 × 60000 / 1200 = 100000
    const result = computePositionSize(100_000, 60000, 58800, config);
    expect(result).toBeCloseTo(100_000, 2);
  });
});

describe("computePositionSize — 边界保护", () => {
  it("entryPrice=0 → 返回 0", () => {
    expect(computePositionSize(100_000, 0, 58800, strategyConfig)).toBe(0);
  });

  it("entryPrice < 0 → 返回 0", () => {
    expect(computePositionSize(100_000, -1, 58800, strategyConfig)).toBe(0);
  });

  it("entry === stop（止损距离=0）→ 返回 0", () => {
    expect(computePositionSize(100_000, 60000, 60000, strategyConfig)).toBe(0);
  });

  it("accountSize=0 → 返回 0（零账户）", () => {
    // riskAmount=0 → positionSize=0
    expect(computePositionSize(0, 60000, 58800, strategyConfig)).toBe(0);
  });
});

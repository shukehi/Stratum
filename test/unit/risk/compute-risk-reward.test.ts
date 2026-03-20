import { describe, it, expect } from "vitest";
import { computeRiskReward } from "../../../src/services/risk/compute-risk-reward.js";
import type { StructuralSetup } from "../../../src/domain/signal/structural-setup.js";

/** 构造最小化的 StructuralSetup，仅填写 RR 计算所需字段 */
function makeSetup(
  direction: "long" | "short",
  entryLow: number,
  entryHigh: number,
  stopLossHint: number,
  takeProfitHint: number
): StructuralSetup {
  return {
    timeframe: "4h",
    direction,
    entryLow,
    entryHigh,
    stopLossHint,
    takeProfitHint,
    structureScore: 70,
    structureReason: "test",
    invalidationReason: "test",
    confluenceFactors: [],
    confirmationStatus: "confirmed",
    confirmationTimeframe: "1h",
    reasonCodes: [],
  };
}

// ── 做多 RR ────────────────────────────────────────────────────────────────────

describe("computeRiskReward — 做多", () => {
  it("标准做多: RR = (TP - entryHigh) / (entryHigh - SL)", () => {
    // entry=60000, SL=58800, TP=63000
    // risk = 60000-58800=1200, reward=63000-60000=3000, RR=2.5
    const setup = makeSetup("long", 59800, 60000, 58800, 63000);
    expect(computeRiskReward(setup)).toBeCloseTo(2.5, 5);
  });

  it("RR 精确值 = 3.0", () => {
    // entry=60000, SL=59000, TP=63000
    // risk=1000, reward=3000, RR=3
    const setup = makeSetup("long", 59800, 60000, 59000, 63000);
    expect(computeRiskReward(setup)).toBeCloseTo(3.0, 5);
  });

  it("RR < minimumRiskReward (2.0): 应返回小于 2.5 的值", () => {
    // risk=1000, reward=1500, RR=1.5
    const setup = makeSetup("long", 59800, 60000, 59000, 61500);
    expect(computeRiskReward(setup)).toBeCloseTo(1.5, 5);
  });

  it("止损与入场重合（risk=0）→ 返回 0", () => {
    const setup = makeSetup("long", 59800, 60000, 60000, 63000);
    expect(computeRiskReward(setup)).toBe(0);
  });

  it("止损在入场价上方（无效区间，risk<0）→ 返回 0", () => {
    const setup = makeSetup("long", 59800, 60000, 61000, 64000);
    expect(computeRiskReward(setup)).toBe(0);
  });

  it("目标在入场价以下（reward<0）→ 返回负值（由调用方过滤）", () => {
    // reward=59000-60000=-1000, risk=1000, RR=-1
    const setup = makeSetup("long", 59800, 60000, 59000, 59000);
    expect(computeRiskReward(setup)).toBeLessThan(0);
  });
});

// ── 做空 RR ────────────────────────────────────────────────────────────────────

describe("computeRiskReward — 做空", () => {
  it("标准做空: RR = (entryLow - TP) / (SL - entryLow)", () => {
    // entry=60000, SL=61200, TP=57000
    // risk=61200-60000=1200, reward=60000-57000=3000, RR=2.5
    const setup = makeSetup("short", 60000, 60200, 61200, 57000);
    expect(computeRiskReward(setup)).toBeCloseTo(2.5, 5);
  });

  it("RR 精确值 = 3.0", () => {
    // entry=60000, SL=61000, TP=57000
    // risk=1000, reward=3000, RR=3
    const setup = makeSetup("short", 60000, 60200, 61000, 57000);
    expect(computeRiskReward(setup)).toBeCloseTo(3.0, 5);
  });

  it("止损与入场重合（risk=0）→ 返回 0", () => {
    const setup = makeSetup("short", 60000, 60200, 60000, 57000);
    expect(computeRiskReward(setup)).toBe(0);
  });

  it("止损在入场价以下（无效区间）→ 返回 0", () => {
    const setup = makeSetup("short", 60000, 60200, 59000, 57000);
    expect(computeRiskReward(setup)).toBe(0);
  });

  it("目标在入场价以上（reward<0）→ 返回负值", () => {
    const setup = makeSetup("short", 60000, 60200, 61000, 62000);
    expect(computeRiskReward(setup)).toBeLessThan(0);
  });
});

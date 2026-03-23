import { describe, it, expect } from "vitest";
import { buildPositionSizingSummary } from "../../../src/services/risk/compute-position-size.js";
import type { TradeCandidate } from "../../../src/domain/signal/trade-candidate.js";
import { strategyConfig } from "../../../src/app/config.js";

function makeCandidate(overrides: Partial<TradeCandidate> = {}): TradeCandidate {
  return {
    symbol: "BTCUSDT",
    direction: "long",
    timeframe: "4h",
    entryLow: 60000,
    entryHigh: 61000,
    stopLoss: 59000,
    takeProfit: 65000,
    riskReward: 4.0,
    capitalVelocityScore: 85,
    regimeAligned: true,
    participantAligned: true,
    structureReason: "Test",
    contextReason: "Test",
    reasonCodes: [],
    ...overrides,
  };
}

describe("compute-position-size (V2 Physics)", () => {
  it("标准风险计算：1% 风险比例", () => {
    const c = makeCandidate();
    const result = buildPositionSizingSummary({
      candidate: c,
      config: { ...strategyConfig, accountSizeUsd: 10000, riskPerTrade: 0.01 },
      sameDirectionExposureCount: 0,
      sameDirectionOpenRiskPercent: 0,
      portfolioOpenRiskPercent: 0,
    });

    expect(result.riskAmount).toBe(100); // 10000 * 0.01
    expect(result.accountRiskPercent).toBe(1);
  });
});

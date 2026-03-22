import { describe, it, expect } from "vitest";
import { strategyConfig } from "../../../src/app/config.js";

describe("strategyConfig", () => {
  it("minimumRiskReward is 2.5 (derived from 30-35% win rate assumption)", () => {
    expect(strategyConfig.minimumRiskReward).toBe(2.5);
    expect(strategyConfig.riskPerTrade).toBe(0.01);
    const expectedAccountSize =
      process.env.ACCOUNT_SIZE !== undefined ? Number(process.env.ACCOUNT_SIZE) : 10000;
    expect(strategyConfig.accountSizeUsd).toBe(expectedAccountSize);
  });

  it("has correct participant pressure thresholds", () => {
    expect(strategyConfig.minParticipantConfidence).toBe(60);
    expect(strategyConfig.oiCollapseVacuumThresholdPercent).toBe(0.1);
    expect(strategyConfig.basisDivergenceThreshold).toBe(0.002);
    expect(strategyConfig.basisDivergenceConfidenceBoost).toBe(12);
  });

  it("has correct session adjustment factors", () => {
    expect(strategyConfig.enableSessionAdjustment).toBe(true);
    expect(strategyConfig.sessionDiscountFactor).toBe(0.8);
    expect(strategyConfig.sessionPremiumFactor).toBe(1.1);
  });

  it("has correct portfolio risk constraints", () => {
    expect(strategyConfig.maxSameDirectionOpenRiskPercent).toBe(0.02);
    expect(strategyConfig.maxPortfolioOpenRiskPercent).toBe(0.03);
  });

  it("has correct LLM constraints", () => {
    expect(strategyConfig.maxNewsItemsForPrompt).toBe(10);
  });

  it("has correct calibration threshold", () => {
    expect(strategyConfig.calibrationMinSampleSize).toBe(50);
  });

  it("has correct Volume Profile params (PHASE_17)", () => {
    expect(strategyConfig.vpLookbackDays).toBe(30);
    expect(strategyConfig.vpBucketCount).toBe(200);
    expect(strategyConfig.vpValueAreaPercent).toBe(0.70);
    expect(strategyConfig.cvdWindow).toBe(20);
    expect(strategyConfig.cvdNeutralThreshold).toBe(0.05);
  });
});

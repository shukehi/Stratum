import { describe, it, expect } from "vitest";
import { strategyConfig } from "../../../src/app/config.js";

describe("strategyConfig", () => {
  it("minimumRiskReward is 2.5 (derived from 30-35% win rate assumption)", () => {
    expect(strategyConfig.minimumRiskReward).toBe(2.5);
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

  it("has correct LLM constraints", () => {
    expect(strategyConfig.maxNewsItemsForPrompt).toBe(10);
  });

  it("has correct calibration threshold", () => {
    expect(strategyConfig.calibrationMinSampleSize).toBe(50);
  });
});

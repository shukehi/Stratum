import { describe, it, expect } from "vitest";
import type { MarketContext } from "../../../src/domain/market/market-context.js";
import { strategyConfig } from "../../../src/app/config.js";
import { isTradableContext } from "../../../src/services/participants/is-tradable-context.js";

function makeCtx(overrides: Partial<MarketContext> = {}): MarketContext {
  return {
    regime: "trend",
    regimeConfidence: 75,
    regimeReasons: ["trend confirmed"],
    marketDriverType: "new-longs",
    marketDriverConfidence: 80,
    participantBias: "short-crowded",
    participantPressureType: "squeeze-risk",
    participantConfidence: 70,
    participantRationale: "shorts are trapped",
    spotPerpBasis: 0,
    basisDivergence: false,
    liquiditySession: "london_ny_overlap",
    summary: "trend | new-longs | short-crowded",
    reasonCodes: [],
    ...overrides,
  };
}

describe("isTradableContext", () => {
  it("正常趋势环境返回 tradable=true", () => {
    const result = isTradableContext(makeCtx(), strategyConfig);
    expect(result.tradable).toBe(true);
  });

  it("deleveraging vacuum 直接跳过", () => {
    const result = isTradableContext(
      makeCtx({
        marketDriverType: "deleveraging-vacuum",
        reasonCodes: ["DELEVERAGING_VACUUM"],
      }),
      strategyConfig
    );
    expect(result.tradable).toBe(false);
    expect(result.reasonCode).toBe("DELEVERAGING_VACUUM");
  });

  it("regime 低置信度直接跳过", () => {
    const result = isTradableContext(
      makeCtx({ regimeConfidence: strategyConfig.minRegimeConfidence - 1 }),
      strategyConfig
    );
    expect(result.tradable).toBe(false);
    expect(result.reasonCode).toBe("REGIME_LOW_CONFIDENCE");
  });

  it("high-volatility 直接跳过", () => {
    const result = isTradableContext(
      makeCtx({ regime: "high-volatility" }),
      strategyConfig
    );
    expect(result.tradable).toBe(false);
    expect(result.reasonCode).toBe("REGIME_HIGH_VOLATILITY");
  });

  it("event-driven 且未开放时直接跳过", () => {
    const result = isTradableContext(
      makeCtx({ regime: "event-driven" }),
      { ...strategyConfig, allowEventDrivenSignals: false }
    );
    expect(result.tradable).toBe(false);
    expect(result.reasonCode).toBe("REGIME_EVENT_DRIVEN");
  });

  it("participant 方向不清晰时跳过", () => {
    const result = isTradableContext(
      makeCtx({
        participantBias: "balanced",
        participantPressureType: "none",
        participantConfidence: strategyConfig.minParticipantConfidence - 1,
      }),
      strategyConfig
    );
    expect(result.tradable).toBe(false);
    expect(result.reasonCode).toBe("PARTICIPANT_CONFIDENCE_TOO_LOW");
  });
});

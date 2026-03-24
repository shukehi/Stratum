import { expect, test, describe } from "vitest";
import { evaluateSwappingGate } from "../../../src/services/risk/evaluate-exposure-gate.js";
import type { StrategyConfig } from "../../../src/app/config.js";

function buildMockCandidate(symbol: string, direction: "long" | "short", cvs: number): any {
  return {
    symbol,
    direction,
    capitalVelocityScore: cvs,
    timeframe: "4h",
    entryLow: 100,
    entryHigh: 110,
    stopLoss: 90,
    takeProfit: 150,
  };
}

function buildMockPosition(id: string, symbol: string, direction: "long" | "short", cvs: number, ageMs: number = 0): any {
  return {
    id,
    symbol,
    direction,
    capitalVelocityScore: cvs,
    openedAt: Date.now() - ageMs
  };
}

const mockConfig = {
  riskPerTrade: 0.01,
  maxPortfolioOpenRiskPercent: 0.05,
  maxCorrelatedSignalsPerDirection: 1, // trigger swap easily
  cspSwapThresholdTrend: 1.1,
  cspSwapThresholdRange: 1.25,
  cspSwapThresholdHighVolatility: 1.5,
  cspSwapThresholdEventDriven: 999,
} as StrategyConfig;

describe("evaluateSwappingGate (Dynamic Regime Thresholds)", () => {
  test("Trend regime allows swap with 10% CVS improvement", () => {
    // 100 * 1.1 = 110, candidate cvs = 111 > 110
    const candidate = buildMockCandidate("BTCUSDT", "long", 111);
    const positions = [buildMockPosition("pos1", "ETHUSDT", "long", 100)];
    
    const decision = evaluateSwappingGate({
      candidate,
      openPositions: positions,
      portfolioOpenRiskPercent: 0.04,
      config: mockConfig,
      currentRegime: "trend",
      regimeConfidence: 80,
    });

    expect(decision.action).toBe("allow_swap");
    if (decision.action === "allow_swap") {
        expect(decision.targetPositionId).toBe("pos1");
    }
  });

  test("Trend regime blocks swap if CVS improvement < 10%", () => {
    // 100 * 1.1 = 110, candidate cvs = 109 <= 110
    const candidate = buildMockCandidate("BTCUSDT", "long", 109);
    const positions = [buildMockPosition("pos1", "ETHUSDT", "long", 100)];
    
    const decision = evaluateSwappingGate({
      candidate,
      openPositions: positions,
      portfolioOpenRiskPercent: 0.04,
      config: mockConfig,
      currentRegime: "trend",
      regimeConfidence: 80,
    });

    expect(decision.action).toBe("block");
  });

  test("High-volatility regime requires >50% improvement", () => {
    // 100 * 1.5 = 150, candidate cvs = 151 > 150
    const candidate = buildMockCandidate("BTCUSDT", "long", 151);
    const positions = [buildMockPosition("pos1", "ETHUSDT", "long", 100)];

    const decision = evaluateSwappingGate({
      candidate,
      openPositions: positions,
      portfolioOpenRiskPercent: 0.04,
      config: mockConfig,
      currentRegime: "high-volatility",
      regimeConfidence: 80,
    });

    expect(decision.action).toBe("allow_swap");
  });

  test("High-volatility regime blocks if <=50% improvement", () => {
    // 100 * 1.5 = 150, candidate cvs = 149 <= 150
    const candidate = buildMockCandidate("BTCUSDT", "long", 149);
    const positions = [buildMockPosition("pos1", "ETHUSDT", "long", 100)];

    const decision = evaluateSwappingGate({
      candidate,
      openPositions: positions,
      portfolioOpenRiskPercent: 0.04,
      config: mockConfig,
      currentRegime: "high-volatility",
      regimeConfidence: 80,
    });

    expect(decision.action).toBe("block");
  });

  test("Event-driven blocks any swap (threshold 999)", () => {
    // 100 * 999 = 99900
    const candidate = buildMockCandidate("BTCUSDT", "long", 50000); 
    const positions = [buildMockPosition("pos1", "ETHUSDT", "long", 100)];

    const decision = evaluateSwappingGate({
      candidate,
      openPositions: positions,
      portfolioOpenRiskPercent: 0.04,
      config: mockConfig,
      currentRegime: "event-driven",
      regimeConfidence: 80,
    });

    expect(decision.action).toBe("block");
  });

  test("Low confidence penalty increases threshold", () => {
    // For range: default 1.25. If confidence = 50, penalty = (70 - 50)/10 * 0.05 = 0.1
    // Total threshold = 1.25 + 0.1 = 1.35
    const candidate1 = buildMockCandidate("BTCUSDT", "long", 130); // 130 < 135 (Blocked)
    const candidate2 = buildMockCandidate("BTCUSDT", "long", 136); // 136 > 135 (Allowed)
    
    const positions = [buildMockPosition("pos1", "ETHUSDT", "long", 100)];

    const d1 = evaluateSwappingGate({
      candidate: candidate1,
      openPositions: positions,
      portfolioOpenRiskPercent: 0.04,
      config: mockConfig,
      currentRegime: "range",
      regimeConfidence: 50,
    });
    
    expect(d1.action).toBe("block");

    const d2 = evaluateSwappingGate({
      candidate: candidate2,
      openPositions: positions,
      portfolioOpenRiskPercent: 0.04,
      config: mockConfig,
      currentRegime: "range",
      regimeConfidence: 50,
    });

    expect(d2.action).toBe("allow_swap");
  });

  test("Signal decay makes older positions easier to swap", () => {
    // position threshold is 1.25 (range regime)
    // original CVS 100 * 1.25 = 125.
    // If it's 2h old, CVS decays to 50. 50 * 1.25 = 62.5
    const candidate = buildMockCandidate("BTCUSDT", "long", 70); // 70 < 125, but 70 > 62.5
    
    const oldPosition = buildMockPosition("pos1", "ETHUSDT", "long", 100, 2 * 3600000); // 2 hours old

    const decision = evaluateSwappingGate({
      candidate,
      openPositions: [oldPosition],
      portfolioOpenRiskPercent: 0.04,
      config: mockConfig,
      currentRegime: "range",
      regimeConfidence: 80,
    });

    expect(decision.action).toBe("allow_swap");
  });

  test("Direction imbalance protection blocks trade worsening tilt", () => {
    const candidate = buildMockCandidate("BTCUSDT", "long", 500); // 非常高的 CVS，但会加剧倾斜
    
    // 当前有 3 个 long，0 个 short -> 倾斜度 = 3
    const positions = [
      buildMockPosition("pos1", "ETHUSDT", "long", 100),
      buildMockPosition("pos2", "SOLUSDT", "long", 100),
      buildMockPosition("pos3", "ADAUSDT", "long", 100),
    ];

    const decision = evaluateSwappingGate({
      candidate,
      openPositions: positions,
      portfolioOpenRiskPercent: 0.03, // 充足的 global buffer
      config: { ...mockConfig, maxDirectionImbalance: 3, maxCorrelatedSignalsPerDirection: 10 },
      currentRegime: "trend",
      regimeConfidence: 80,
    });

    expect(decision.action).toBe("block");
    if (decision.action === "block") {
      expect(decision.reasonCode).toBe("PORTFOLIO_RISK_LIMIT");
      expect(decision.reason).toContain("组合倾斜度超限");
    }
  });

  test("Direction imbalance protection allows trade balancing tilt", () => {
    const candidate = buildMockCandidate("BTCUSDT", "short", 500); // short 会缓解倾斜
    
    // 当前有 3 个 long，0 个 short -> 倾斜度 = 3
    const positions = [
      buildMockPosition("pos1", "ETHUSDT", "long", 100),
      buildMockPosition("pos2", "SOLUSDT", "long", 100),
      buildMockPosition("pos3", "ADAUSDT", "long", 100),
    ];

    const decision = evaluateSwappingGate({
      candidate,
      openPositions: positions,
      portfolioOpenRiskPercent: 0.03,
      config: { ...mockConfig, maxDirectionImbalance: 3, maxCorrelatedSignalsPerDirection: 10 },
      currentRegime: "trend",
      regimeConfidence: 80,
    });

    // 允许入场，因为短期做空是反向操作
    expect(decision.action).toBe("allow_direct");
  });
});

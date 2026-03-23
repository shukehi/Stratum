import { describe, it, expect } from "vitest";
import { evaluateConsensus } from "../../../src/services/consensus/evaluate-consensus.js";
import type { ConsensusInput } from "../../../src/services/consensus/evaluate-consensus.js";
import type { StructuralSetup } from "../../../src/domain/signal/structural-setup.js";

function makeSetup(overrides: Partial<StructuralSetup> = {}): StructuralSetup {
  return {
    timeframe: "4h",
    direction: "long",
    entryLow: 59000,
    entryHigh: 60000,
    stopLossHint: 58000,
    takeProfitHint: 64000,
    structureScore: 80,
    structureReason: "Test Setup",
    invalidationReason: "Test Invalid",
    confluenceFactors: [],
    confirmationStatus: "confirmed",
    confirmationTimeframe: "1h",
    reasonCodes: [],
    ...overrides,
  };
}

function makeInput(overrides: Partial<ConsensusInput> = {}): ConsensusInput {
  return {
    symbol: "BTCUSDT",
    setups: [makeSetup()],
    ctx: {
      regime: "range",
      regimeConfidence: 80,
      regimeReasons: [],
      participantBias: "balanced",
      participantPressureType: "none", 
      participantConfidence: 80,
      participantRationale: "",
      spotPerpBasis: 0,
      basisDivergence: false,
      liquiditySession: "london_ramp",
      summary: "Test Context",
      reasonCodes: [],
    },
    config: {
      minStructureScore: 60,
      minimumRiskReward: 1.5,
      maxStopDistanceAtr: 5.0,
    } as any,
    ...overrides,
  };
}

describe("evaluateConsensus (V3 Physics Refactor)", () => {
  it("物理硬过滤：无效结构被丢弃", () => {
    const input = makeInput({ setups: [makeSetup({ confirmationStatus: "invalidated" })] });
    const results = evaluateConsensus(input);
    expect(results).toHaveLength(0);
  });

  describe("CVS 计算逻辑验证", () => {
    it("标准信号：基础 CVS 计算 (含对齐乘数 1.2x)", () => {
      const input = makeInput({ setups: [makeSetup({ structureScore: 70 })] });
      // regime="range" & pressure="none" 为对齐状态 => 70 * 1.2 = 84
      const results = evaluateConsensus(input);
      expect(results[0].capitalVelocityScore).toBe(84);
    });

    it("高周转奖励：RR >= 3.0 获得 1.1x 加成 (含对齐乘数 1.2x)", () => {
      const input = makeInput({ 
        setups: [makeSetup({ 
          structureScore: 70,
          entryHigh: 60000,
          stopLossHint: 59000,
          takeProfitHint: 63000 // RR = 3.0
        })] 
      });
      // 70 * 1.1 (RR奖励) * 1.2 (对齐乘数) = 92.4
      const [c] = evaluateConsensus(input);
      expect(c.capitalVelocityScore).toBe(92.4);
    });
  });

  it("输出契约：包含正确的物理量", () => {
    const input = makeInput();
    const results = evaluateConsensus(input);
    expect(results).toHaveLength(1);
    expect(results[0].symbol).toBe("BTCUSDT");
    expect(results[0].capitalVelocityScore).toBeGreaterThan(0);
  });
});

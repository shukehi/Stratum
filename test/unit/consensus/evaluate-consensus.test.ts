import { describe, it, expect } from "vitest";
import { evaluateConsensus, applySignalDecay } from "../../../src/services/consensus/evaluate-consensus.js";
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
      baseSlippagePct: 0,
      sessionSlippageMultiplier: 2.5,
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

    it("滑点摩擦：基础滑点使得 CVS 下降 (baseSlippagePct > 0)", () => {
      const mockConfig = makeInput().config;
      const input = makeInput({ setups: [makeSetup({ structureScore: 70 })], config: { ...mockConfig, baseSlippagePct: 0.001 } as any });
      // effective_slip = 0.002, friction = 1.2, numerator = 84
      // cvs = 84 / 1.2 = 70
      const [c] = evaluateConsensus(input);
      expect(c.capitalVelocityScore).toBe(70);
    });

    it("低流动性时段：SESSION_LOW_LIQUIDITY_DISCOUNT 放大滑点惩罚", () => {
      const mockConfig = makeInput().config;
      const input = makeInput({ setups: [makeSetup({ structureScore: 70 })], config: { ...mockConfig, baseSlippagePct: 0.001 } as any });
      input.ctx.reasonCodes.push("SESSION_LOW_LIQUIDITY_DISCOUNT");
      // effective_slip = 0.002 * 2.5 = 0.005
      // friction = 1.5, numerator = 84
      // cvs = 84 / 1.5 = 56
      const [c] = evaluateConsensus(input);
      expect(c.capitalVelocityScore).toBe(56);
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

describe("applySignalDecay (Half-life decay model)", () => {
  it("0 hours -> 100%", () => {
    expect(applySignalDecay(100, 0)).toBe(100);
  });

  it("2 hours (1 half-life) -> 50%", () => {
    expect(applySignalDecay(100, 2 * 3600_000)).toBe(50);
  });

  it("6 hours (3 half-lives) -> hits the 20% floor barrier", () => {
    expect(applySignalDecay(100, 6 * 3600_000)).toBe(20); // 100 * 0.125 = 12.5, clamps to floor 20
  });

  it("Negative age prevents decaying -> 100%", () => {
    expect(applySignalDecay(100, -3600_000)).toBe(100);
  });
});

describe("TP Reachability Assessment", () => {
  const baseOverrides = { structureScore: 100, entryLow: 90, entryHigh: 100, stopLossHint: 80, takeProfitHint: 150, direction: "long" as const };

  it("无阻档时 CVS 保持 100%", () => {
    const input = makeInput({ setups: [makeSetup(baseOverrides)] });
    const [c1] = evaluateConsensus(input);

    const inputWithObstacles = makeInput({
      setups: [makeSetup(baseOverrides)],
    });
    inputWithObstacles.equalLevels = [{ price: 160, type: "high", touchCount: 2, toleranceAbsolute: 5, firstTimestamp: 0, lastTimestamp: 0 }]; // 阻力在 TP 之上
    const [c2] = evaluateConsensus(inputWithObstacles);

    expect(c2.capitalVelocityScore).toBe(c1.capitalVelocityScore);
  });

  it("1 处阻碍时 CVS 降权至 85%", () => {
    const input = makeInput({ setups: [makeSetup(baseOverrides)] });
    const [c1] = evaluateConsensus(input);

    const inputWithObstacles = makeInput({
      setups: [makeSetup(baseOverrides)],
    });
    inputWithObstacles.equalLevels = [{ price: 120, type: "high", touchCount: 2, toleranceAbsolute: 5, firstTimestamp: 0, lastTimestamp: 0 }]; // 阻力在路径上
    const [c2] = evaluateConsensus(inputWithObstacles);

    expect(c2.capitalVelocityScore).toBeCloseTo(c1.capitalVelocityScore * 0.85, 0);
    expect(c2.contextReason).toContain("TP路径受阻(x0.85)");
  });

  it("多处阻碍时 CVS 降权至 70%", () => {
    const input = makeInput({ setups: [makeSetup(baseOverrides)] });
    const [c1] = evaluateConsensus(input);

    const inputWithObstacles = makeInput({
      setups: [makeSetup(baseOverrides)],
    });
    inputWithObstacles.equalLevels = [
        { price: 120, type: "high", touchCount: 2, toleranceAbsolute: 5, firstTimestamp: 0, lastTimestamp: 0 },
        { price: 140, type: "high", touchCount: 2, toleranceAbsolute: 5, firstTimestamp: 0, lastTimestamp: 0 }
    ];
    const [c2] = evaluateConsensus(inputWithObstacles);

    expect(c2.capitalVelocityScore).toBeCloseTo(c1.capitalVelocityScore * 0.70, 0);
    expect(c2.contextReason).toContain("TP路径受阻(x0.7)");
  });
});


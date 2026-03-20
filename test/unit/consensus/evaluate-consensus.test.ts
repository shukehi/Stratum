import { describe, it, expect } from "vitest";
import { evaluateConsensus } from "../../../src/services/consensus/evaluate-consensus.js";
import type { ConsensusInput } from "../../../src/services/consensus/evaluate-consensus.js";
import type { StructuralSetup } from "../../../src/domain/signal/structural-setup.js";
import type { MarketContext } from "../../../src/domain/market/market-context.js";
import { strategyConfig } from "../../../src/app/config.js";

// ── 测试夹具 ───────────────────────────────────────────────────────────────────

/**
 * 构造通过所有门槛的标准做多 StructuralSetup:
 *   entry=60000, SL=58800, TP=63000 → RR=2.5 (= minimumRiskReward)
 *   score=80, confirmed, 2 confluenceFactors
 */
function makePassingLongSetup(overrides: Partial<StructuralSetup> = {}): StructuralSetup {
  return {
    timeframe: "4h",
    direction: "long",
    entryLow: 59800,
    entryHigh: 60000,
    stopLossHint: 58800,
    takeProfitHint: 63000,
    structureScore: 80,
    structureReason: "FVG + 流动性扫描",
    invalidationReason: "1h 收盘低于 58800",
    confluenceFactors: ["fvg", "liquidity-sweep"],
    confirmationStatus: "confirmed",
    confirmationTimeframe: "1h",
    reasonCodes: [],
    ...overrides,
  };
}

/**
 * 构造通过所有门槛的标准做空 StructuralSetup:
 *   entry=60000, SL=61200, TP=57000 → RR=2.5
 */
function makePassingShortSetup(overrides: Partial<StructuralSetup> = {}): StructuralSetup {
  return {
    timeframe: "4h",
    direction: "short",
    entryLow: 60000,
    entryHigh: 60200,
    stopLossHint: 61200,
    takeProfitHint: 57000,
    structureScore: 80,
    structureReason: "FVG + 流动性扫描",
    invalidationReason: "1h 收盘高于 61200",
    confluenceFactors: ["fvg", "liquidity-sweep"],
    confirmationStatus: "confirmed",
    confirmationTimeframe: "1h",
    reasonCodes: [],
    ...overrides,
  };
}

/** 构造通过所有上下文检查的 MarketContext（趋势 + 中性参与者） */
function makeBullishCtx(overrides: Partial<MarketContext> = {}): MarketContext {
  return {
    regime: "trend",
    regimeConfidence: 75,
    regimeReasons: ["均线多头排列"],
    participantBias: "balanced",
    participantPressureType: "none",
    participantConfidence: 70,
    participantRationale: "OI 平稳",
    spotPerpBasis: 0.001,
    basisDivergence: false,
    liquiditySession: "london_ramp",
    summary: "趋势市场，中性参与者，London 时段",
    reasonCodes: [],
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<ConsensusInput> = {},
  setupOverrides: Partial<StructuralSetup> = {},
  ctxOverrides: Partial<MarketContext> = {}
): ConsensusInput {
  return {
    symbol: "BTCUSDT",
    setups: [makePassingLongSetup(setupOverrides)],
    ctx: makeBullishCtx(ctxOverrides),
    config: strategyConfig,
    ...overrides,
  };
}

// ── 门槛 1: invalidated ────────────────────────────────────────────────────────

describe("evaluateConsensus — 门槛: invalidated 丢弃", () => {
  it("confirmationStatus=invalidated → 不产生候选", () => {
    const input = makeInput({}, { confirmationStatus: "invalidated" });
    expect(evaluateConsensus(input)).toHaveLength(0);
  });

  it("confirmationStatus=confirmed → 通过（有候选）", () => {
    const input = makeInput();
    expect(evaluateConsensus(input).length).toBeGreaterThan(0);
  });
});

// ── 门槛 2: DELEVERAGING_VACUUM ────────────────────────────────────────────────

describe("evaluateConsensus — 门槛: DELEVERAGING_VACUUM", () => {
  it("ctx 含 DELEVERAGING_VACUUM → 所有 setup 丢弃", () => {
    const input = makeInput({}, {}, { reasonCodes: ["DELEVERAGING_VACUUM"] });
    expect(evaluateConsensus(input)).toHaveLength(0);
  });

  it("ctx 无 DELEVERAGING_VACUUM → 不影响", () => {
    const input = makeInput({}, {}, { reasonCodes: [] });
    expect(evaluateConsensus(input).length).toBeGreaterThan(0);
  });
});

// ── 门槛 3: structureScore ─────────────────────────────────────────────────────

describe("evaluateConsensus — 门槛: structureScore < minStructureScore", () => {
  it("structureScore=59 (< 60) → 丢弃", () => {
    const input = makeInput({}, { structureScore: 59 });
    expect(evaluateConsensus(input)).toHaveLength(0);
  });

  it("structureScore=60 (= minStructureScore) → 通过", () => {
    // score=60: 不满足 high-conviction(80)，不满足 standard(65)，→ watch
    // regimeAligned=true, participantAligned=true, score=60 → watch
    const input = makeInput({}, { structureScore: 60 });
    const results = evaluateConsensus(input);
    expect(results).toHaveLength(1);
    expect(results[0].signalGrade).toBe("watch");
  });
});

// ── 门槛 4: 弱参与者 ──────────────────────────────────────────────────────────

describe("evaluateConsensus — 门槛: 弱参与者覆盖", () => {
  const weakCtx: Partial<MarketContext> = { participantConfidence: 55 }; // < 60

  it("弱参与者 + score=70 (< 75) → 丢弃", () => {
    const input = makeInput({}, { structureScore: 70 }, weakCtx);
    expect(evaluateConsensus(input)).toHaveLength(0);
  });

  it("弱参与者 + score=75 (= minStructureScoreForWeakParticipantOverride) → 通过", () => {
    const input = makeInput({}, { structureScore: 75 }, weakCtx);
    // score=75 >= 65 AND regimeAligned=true → standard; 弱参与者上限 → watch
    const results = evaluateConsensus(input);
    expect(results).toHaveLength(1);
    expect(results[0].signalGrade).toBe("watch");
  });

  it("参与者置信度 = minParticipantConfidence(60) → 不触发弱参与者逻辑", () => {
    const input = makeInput({}, { structureScore: 70 }, { participantConfidence: 60 });
    expect(evaluateConsensus(input).length).toBeGreaterThan(0);
  });
});

// ── 门槛 5: RR 不足 ────────────────────────────────────────────────────────────

describe("evaluateConsensus — 门槛: RR < minimumRiskReward", () => {
  it("RR < 2.5 → 丢弃", () => {
    // entry=60000, SL=58800, TP=61200 → risk=1200, reward=1200, RR=1.0
    const input = makeInput({}, {
      entryHigh: 60000,
      stopLossHint: 58800,
      takeProfitHint: 61200,
    });
    expect(evaluateConsensus(input)).toHaveLength(0);
  });

  it("RR = 2.5 (= minimumRiskReward) → 通过", () => {
    // default setup: RR=2.5
    const input = makeInput();
    expect(evaluateConsensus(input).length).toBeGreaterThan(0);
  });

  it("candidate 包含正确的 riskReward 值", () => {
    const input = makeInput();
    const results = evaluateConsensus(input);
    expect(results[0].riskReward).toBeCloseTo(2.5, 5);
  });
});

// ── 门槛 6: 止损距离过宽 ──────────────────────────────────────────────────────

describe("evaluateConsensus — 门槛: 止损距离 > maxStopDistanceAtr", () => {
  it("stopDistance > maxStopDistanceAtr × ATR → 丢弃", () => {
    // entry=60000, SL=58800 → stopDistance=1200; ATR=400; maxStopDistanceAtr=2.5 → limit=1000
    const input = makeInput({ baselineAtr: 400 });
    expect(evaluateConsensus(input)).toHaveLength(0);
  });

  it("stopDistance ≤ maxStopDistanceAtr × ATR → 通过", () => {
    // entry=60000, SL=58800 → stopDistance=1200; ATR=500; limit=2.5×500=1250
    const input = makeInput({ baselineAtr: 500 });
    expect(evaluateConsensus(input).length).toBeGreaterThan(0);
  });

  it("baselineAtr 未提供 → 跳过止损距离门槛", () => {
    // 即使止损很宽也通过（无 ATR 参考）
    const input = makeInput({
      setups: [makePassingLongSetup({ stopLossHint: 50000 })], // 极宽止损
    });
    // RR=(63000-60000)/(60000-50000)=0.3 < 2.5 → 被 RR 门槛丢弃（不是 ATR 门槛）
    expect(evaluateConsensus(input)).toHaveLength(0);
  });

  it("baselineAtr=0 → 跳过止损距离门槛（边界保护）", () => {
    const input = makeInput({ baselineAtr: 0 });
    expect(evaluateConsensus(input).length).toBeGreaterThan(0);
  });
});

// ── 门槛 7: 相关性暴露超限 ────────────────────────────────────────────────────

describe("evaluateConsensus — 门槛: 相关性暴露", () => {
  it("openLongCount >= maxCorrelatedSignalsPerDirection(2) → 做多丢弃", () => {
    const input = makeInput({ openLongCount: 2 });
    expect(evaluateConsensus(input)).toHaveLength(0);
  });

  it("openLongCount = 1 (< 2) → 做多通过", () => {
    const input = makeInput({ openLongCount: 1 });
    expect(evaluateConsensus(input).length).toBeGreaterThan(0);
  });

  it("openShortCount >= 2 → 做空丢弃", () => {
    const input = makeInput(
      { openShortCount: 2 },
      undefined,
      undefined
    );
    // 当前 setup 是 long，短头超限不影响 long
    expect(evaluateConsensus(input).length).toBeGreaterThan(0);
  });

  it("做空 setup 且 openShortCount >= 2 → 丢弃", () => {
    const input: ConsensusInput = {
      symbol: "BTCUSDT",
      setups: [makePassingShortSetup()],
      ctx: makeBullishCtx(),
      config: strategyConfig,
      openShortCount: 2,
    };
    expect(evaluateConsensus(input)).toHaveLength(0);
  });
});

// ── 信号等级：基础等级 ─────────────────────────────────────────────────────────

describe("evaluateConsensus — 信号等级: 基础等级", () => {
  it("score=80 + regimeAligned + participantAligned + 2 confluenceFactors → high-conviction", () => {
    // regime=trend(aligned), pressureType=none(aligned for long), score=80, confluence=2
    const input = makeInput();
    const results = evaluateConsensus(input);
    expect(results[0].signalGrade).toBe("high-conviction");
  });

  it("score=65 + regimeAligned + participantAligned + 1 confluenceFactor → standard", () => {
    const input = makeInput({}, {
      structureScore: 65,
      confluenceFactors: ["fvg"],   // only 1 → no confluence bonus
    });
    // score=65, regime=trend(aligned), pressure=none(aligned), hasConfluence=false
    // → base: 65 >= 65 AND (aligned OR aligned) → standard
    const results = evaluateConsensus(input);
    expect(results[0].signalGrade).toBe("standard");
  });

  it("score=65 + NOT regimeAligned + NOT participantAligned → watch", () => {
    // high-volatility → regimeAligned=false; flush-risk + long → participantAligned=false
    const input = makeInput(
      {},
      { structureScore: 65, confluenceFactors: ["fvg"] },
      { regime: "high-volatility", participantPressureType: "flush-risk" }
    );
    const results = evaluateConsensus(input);
    expect(results[0].signalGrade).toBe("watch");
  });

  it("score=64 (< 65) → watch，即使两侧都校准", () => {
    const input = makeInput({}, { structureScore: 64 });
    const results = evaluateConsensus(input);
    expect(results[0].signalGrade).toBe("watch");
  });
});

// ── 信号等级：upper cap ────────────────────────────────────────────────────────

describe("evaluateConsensus — 信号等级: 上限修正", () => {
  it("pending → 上限 watch（即使基础等级为 high-conviction）", () => {
    const input = makeInput({}, { confirmationStatus: "pending" });
    const results = evaluateConsensus(input);
    expect(results[0].signalGrade).toBe("watch");
  });

  it("弱参与者 + high 结构分 → 通过门槛但上限 watch", () => {
    // participantConfidence=55 < 60, score=75 >= 75 → 通过门槛 4
    // base grade: score=75 >=65, regime=trend(aligned) → standard
    // 弱参与者上限 → watch
    const input = makeInput(
      {},
      { structureScore: 75 },
      { participantConfidence: 55 }
    );
    const results = evaluateConsensus(input);
    expect(results[0].signalGrade).toBe("watch");
  });

  it("SESSION_LOW_LIQUIDITY_DISCOUNT: high-conviction → standard", () => {
    const input = makeInput({}, {
      reasonCodes: ["SESSION_LOW_LIQUIDITY_DISCOUNT"],
    });
    // base: score=80, regime=trend, pressure=none → high-conviction
    // 折扣 → standard
    const results = evaluateConsensus(input);
    expect(results[0].signalGrade).toBe("standard");
  });

  it("SESSION_LOW_LIQUIDITY_DISCOUNT: standard → watch", () => {
    const input = makeInput({}, {
      structureScore: 65,
      confluenceFactors: ["fvg"],
      reasonCodes: ["SESSION_LOW_LIQUIDITY_DISCOUNT"],
    });
    // base: score=65, regime=trend(aligned) → standard
    // 折扣 → watch
    const results = evaluateConsensus(input);
    expect(results[0].signalGrade).toBe("watch");
  });

  it("SESSION_LOW_LIQUIDITY_DISCOUNT: watch → watch (底层不再降级)", () => {
    const input = makeInput({}, {
      structureScore: 64,
      reasonCodes: ["SESSION_LOW_LIQUIDITY_DISCOUNT"],
    });
    // base: score=64 → watch; 折扣后仍 watch
    const results = evaluateConsensus(input);
    expect(results[0].signalGrade).toBe("watch");
  });

  it("pending 优先于 SESSION_LOW_LIQUIDITY_DISCOUNT（先置顶 watch）", () => {
    const input = makeInput({}, {
      confirmationStatus: "pending",
      reasonCodes: ["SESSION_LOW_LIQUIDITY_DISCOUNT"],
    });
    // pending 先应用 → watch; 折扣不再进一步影响
    expect(evaluateConsensus(input)[0].signalGrade).toBe("watch");
  });
});

// ── 方向校准 ──────────────────────────────────────────────────────────────────

describe("evaluateConsensus — 方向校准: isRegimeAligned", () => {
  it("regime=trend → regimeAligned=true", () => {
    const input = makeInput({}, {}, { regime: "trend" });
    expect(evaluateConsensus(input)[0].regimeAligned).toBe(true);
  });

  it("regime=range → regimeAligned=true", () => {
    const input = makeInput({}, {}, { regime: "range" });
    expect(evaluateConsensus(input)[0].regimeAligned).toBe(true);
  });

  it("regime=high-volatility → regimeAligned=false", () => {
    const input = makeInput({}, {}, { regime: "high-volatility" });
    expect(evaluateConsensus(input)[0].regimeAligned).toBe(false);
  });

  it("regime=event-driven + allowEventDrivenSignals=false → regimeAligned=false", () => {
    const input = makeInput({}, {}, { regime: "event-driven" });
    // strategyConfig.allowEventDrivenSignals = false
    expect(evaluateConsensus(input)[0].regimeAligned).toBe(false);
  });

  it("regime=event-driven + allowEventDrivenSignals=true → regimeAligned=true", () => {
    const config = { ...strategyConfig, allowEventDrivenSignals: true };
    const input: ConsensusInput = {
      symbol: "BTCUSDT",
      setups: [makePassingLongSetup()],
      ctx: makeBullishCtx({ regime: "event-driven" }),
      config,
    };
    expect(evaluateConsensus(input)[0].regimeAligned).toBe(true);
  });
});

describe("evaluateConsensus — 方向校准: isParticipantAligned", () => {
  it("pressureType=none → participantAligned=true（长/空均适用）", () => {
    const input = makeInput({}, {}, { participantPressureType: "none" });
    expect(evaluateConsensus(input)[0].participantAligned).toBe(true);
  });

  it("做多 + squeeze-risk（空头被挤）→ participantAligned=true", () => {
    const input = makeInput({}, {}, { participantPressureType: "squeeze-risk" });
    expect(evaluateConsensus(input)[0].participantAligned).toBe(true);
  });

  it("做多 + flush-risk（多头被清）→ participantAligned=false（逆势）", () => {
    const input = makeInput({}, {}, { participantPressureType: "flush-risk" });
    expect(evaluateConsensus(input)[0].participantAligned).toBe(false);
  });

  it("做空 + flush-risk → participantAligned=true", () => {
    const input: ConsensusInput = {
      symbol: "BTCUSDT",
      setups: [makePassingShortSetup()],
      ctx: makeBullishCtx({ participantPressureType: "flush-risk" }),
      config: strategyConfig,
    };
    expect(evaluateConsensus(input)[0].participantAligned).toBe(true);
  });

  it("做空 + squeeze-risk → participantAligned=false（逆势）", () => {
    const input: ConsensusInput = {
      symbol: "BTCUSDT",
      setups: [makePassingShortSetup()],
      ctx: makeBullishCtx({ participantPressureType: "squeeze-risk" }),
      config: strategyConfig,
    };
    expect(evaluateConsensus(input)[0].participantAligned).toBe(false);
  });
});

// ── 输出契约 ──────────────────────────────────────────────────────────────────

describe("evaluateConsensus — 输出契约", () => {
  it("candidate 包含正确的 symbol、direction、timeframe", () => {
    const input = makeInput({ symbol: "ETHUSDT" });
    const results = evaluateConsensus(input);
    expect(results[0].symbol).toBe("ETHUSDT");
    expect(results[0].direction).toBe("long");
    expect(results[0].timeframe).toBe("4h");
  });

  it("candidate.stopLoss = setup.stopLossHint", () => {
    const input = makeInput();
    const results = evaluateConsensus(input);
    expect(results[0].stopLoss).toBe(makePassingLongSetup().stopLossHint);
  });

  it("candidate.takeProfit = setup.takeProfitHint", () => {
    const input = makeInput();
    const results = evaluateConsensus(input);
    expect(results[0].takeProfit).toBe(makePassingLongSetup().takeProfitHint);
  });

  it("reasonCodes 合并去重了 setup 和 ctx 的 codes", () => {
    const input = makeInput(
      {},
      { reasonCodes: ["STRUCTURE_CONFLUENCE_BOOST"] },
      { reasonCodes: ["REGIME_AMBIGUOUS"] }
    );
    const codes = evaluateConsensus(input)[0].reasonCodes;
    expect(codes).toContain("STRUCTURE_CONFLUENCE_BOOST");
    expect(codes).toContain("REGIME_AMBIGUOUS");
  });

  it("reasonCodes 无重复", () => {
    const input = makeInput(
      {},
      { reasonCodes: ["STRUCTURE_CONFLUENCE_BOOST"] },
      { reasonCodes: ["STRUCTURE_CONFLUENCE_BOOST"] }
    );
    const codes = evaluateConsensus(input)[0].reasonCodes;
    expect(codes.filter(c => c === "STRUCTURE_CONFLUENCE_BOOST")).toHaveLength(1);
  });

  it("contextReason = ctx.summary", () => {
    const input = makeInput({}, {}, { summary: "测试摘要" });
    expect(evaluateConsensus(input)[0].contextReason).toBe("测试摘要");
  });

  it("macroReason 不存在（PHASE_06 不注入宏观）", () => {
    const input = makeInput();
    expect(evaluateConsensus(input)[0].macroReason).toBeUndefined();
  });
});

// ── 多 setup 场景 ─────────────────────────────────────────────────────────────

describe("evaluateConsensus — 多 setup 场景", () => {
  it("两个通过门槛的 setup → 返回两个候选", () => {
    const input: ConsensusInput = {
      symbol: "BTCUSDT",
      setups: [makePassingLongSetup(), makePassingShortSetup()],
      ctx: makeBullishCtx(),
      config: strategyConfig,
    };
    expect(evaluateConsensus(input)).toHaveLength(2);
  });

  it("一通过一失效 → 只返回一个候选", () => {
    const input: ConsensusInput = {
      symbol: "BTCUSDT",
      setups: [
        makePassingLongSetup(),
        makePassingLongSetup({ confirmationStatus: "invalidated" }),
      ],
      ctx: makeBullishCtx(),
      config: strategyConfig,
    };
    expect(evaluateConsensus(input)).toHaveLength(1);
  });

  it("空 setup 数组 → 空输出", () => {
    const input: ConsensusInput = {
      symbol: "BTCUSDT",
      setups: [],
      ctx: makeBullishCtx(),
      config: strategyConfig,
    };
    expect(evaluateConsensus(input)).toHaveLength(0);
  });
});

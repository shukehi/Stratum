import { describe, it, expect, vi, beforeEach } from "vitest";
import { assessMacroOverlay } from "../../../src/services/macro/assess-macro-overlay.js";
import type { LlmCallFn } from "../../../src/services/macro/assess-macro-overlay.js";
import type { NewsItem } from "../../../src/domain/news/news-item.js";
import type { TradeCandidate } from "../../../src/domain/signal/trade-candidate.js";
import { strategyConfig } from "../../../src/app/config.js";
import { logger } from "../../../src/app/logger.js";

// ── 测试夹具 ──────────────────────────────────────────────────────────────────

const SAMPLE_NEWS: NewsItem[] = [
  {
    id: "news-1",
    source: "Reuters",
    publishedAt: "2026-03-20T08:00:00Z",
    title: "Fed signals rate cuts possible in Q3",
    category: "macro",
  },
  {
    id: "news-2",
    source: "CoinDesk",
    publishedAt: "2026-03-20T09:00:00Z",
    title: "Bitcoin ETF inflows hit new record",
    category: "crypto",
  },
];

/** 构造返回指定 JSON 的 LLM mock */
function makeLlm(response: Record<string, unknown>): LlmCallFn {
  return async () => JSON.stringify(response);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

function bullishResponse() {
  return {
    macroBias: "bullish",
    confidenceScore: 8,
    btcRelevance: 8,
    catalystSummary: "Fed pivot supports risk-on assets including BTC.",
    riskFlags: [],
  };
}

function bearishResponse(riskFlags: string[] = []) {
  return {
    macroBias: "bearish",
    confidenceScore: 9,
    btcRelevance: 8,
    catalystSummary: "Hawkish signals threaten risk assets.",
    riskFlags,
  };
}

function lowConfidenceResponse() {
  return {
    macroBias: "bearish",
    confidenceScore: 4, // < minimumMacroConfidence(7)
    btcRelevance: 8,
    catalystSummary: "Mixed signals, insufficient confidence.",
    riskFlags: [],
  };
}

function lowRelevanceResponse() {
  return {
    macroBias: "bearish",
    confidenceScore: 9,
    btcRelevance: 3, // < minimumBtcRelevance(6)
    catalystSummary: "Geopolitical risk but low BTC relevance.",
    riskFlags: ["NATO summit"],
  };
}

function makeCandidate(overrides: Partial<TradeCandidate> = {}): TradeCandidate {
  return {
    symbol: "BTCUSDT",
    direction: "long",
    timeframe: "4h",
    entryLow: 59800,
    entryHigh: 60000,
    stopLoss: 58800,
    takeProfit: 63000,
    riskReward: 2.5,
    regimeAligned: true,
    participantAligned: true,
    structureReason: "Bullish FVG reclaim",
    contextReason: "Regime: trend (75%) | Driver: new-longs (82%) | Participants: short-crowded / squeeze-risk (70%) | Session: london_ny_overlap",
    signalGrade: "high-conviction",
    reasonCodes: [],
    ...overrides,
  };
}

// ── MacroAssessment 透传 ───────────────────────────────────────────────────────

describe("assessMacroOverlay — assessment 透传", () => {
  it("assessment 包含 LLM 返回的原始 macroBias", async () => {
    const { assessment } = await assessMacroOverlay(SAMPLE_NEWS, makeCandidate(), strategyConfig, makeLlm(bullishResponse()));
    expect(assessment.macroBias).toBe("bullish");
    expect(assessment.confidenceScore).toBe(8);
  });

  it("assessment 包含 rawPrompt（非空字符串）", async () => {
    const { assessment } = await assessMacroOverlay(SAMPLE_NEWS, makeCandidate(), strategyConfig, makeLlm(bullishResponse()));
    expect(assessment.rawPrompt.length).toBeGreaterThan(0);
    expect(assessment.rawPrompt).toContain("Fed signals rate cuts");
    expect(assessment.rawPrompt).toContain("Direction: long");
  });

  it("成功完成时会记录宏观评估日志", async () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => logger);
    await assessMacroOverlay(SAMPLE_NEWS, makeCandidate(), strategyConfig, makeLlm(bullishResponse()));
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "BTCUSDT",
        direction: "long",
        timeframe: "4h",
        macroBias: "bullish",
        confidenceScore: 8,
        btcRelevance: 8,
        riskFlags: 0,
        action: "pass",
      }),
      "Macro overlay assessment completed"
    );
  });
});

// ── 决策规则 a: 低置信度 → pass ──────────────────────────────────────────────

describe("assessMacroOverlay — 低置信度 → pass", () => {
  it("confidenceScore < minimumMacroConfidence(7) → action=pass", async () => {
    const { decision } = await assessMacroOverlay(SAMPLE_NEWS, makeCandidate(), strategyConfig, makeLlm(lowConfidenceResponse()));
    expect(decision.action).toBe("pass");
  });

  it("低置信度时 reasonCodes 为空", async () => {
    const { decision } = await assessMacroOverlay(SAMPLE_NEWS, makeCandidate(), strategyConfig, makeLlm(lowConfidenceResponse()));
    expect(decision.reasonCodes).toHaveLength(0);
  });
});

// ── 决策规则 b: 低 BTC 相关性 → pass ────────────────────────────────────────

describe("assessMacroOverlay — 低 BTC 相关性 → pass", () => {
  it("btcRelevance < minimumBtcRelevance(6) → action=pass", async () => {
    const { decision } = await assessMacroOverlay(SAMPLE_NEWS, makeCandidate(), strategyConfig, makeLlm(lowRelevanceResponse()));
    expect(decision.action).toBe("pass");
  });
});

// ── 决策规则 c: 看多 → pass ──────────────────────────────────────────────────

describe("assessMacroOverlay — macroBias=bullish → pass", () => {
  it("看多高置信度 → action=pass", async () => {
    const { decision } = await assessMacroOverlay(SAMPLE_NEWS, makeCandidate({ direction: "long" }), strategyConfig, makeLlm(bullishResponse()));
    expect(decision.action).toBe("pass");
  });

  it("看多 + riskFlags 非空 → aligned long 被降级为 watch-only", async () => {
    const response = { ...bullishResponse(), riskFlags: ["FOMC meeting"] };
    const { decision } = await assessMacroOverlay(SAMPLE_NEWS, makeCandidate({ direction: "long" }), strategyConfig, makeLlm(response));
    expect(decision.action).toBe("downgrade");
    expect(decision.reasonCodes).toContain("EVENT_WINDOW_WATCH_ONLY");
    expect(decision.reasonCodes).toContain("MACRO_DOWNGRADED");
  });

  it("bullish 宏观不会自动 block short watch 候选", async () => {
    const { decision } = await assessMacroOverlay(
      SAMPLE_NEWS,
      makeCandidate({ direction: "short", signalGrade: "watch" }),
      strategyConfig,
      makeLlm({ ...bullishResponse(), riskFlags: ["ETF decision"] })
    );
    expect(decision.action).toBe("downgrade");
    expect(decision.reasonCodes).not.toContain("MACRO_BLOCKED");
  });

  it("中性 + 无事件风险 → action=pass", async () => {
    const { decision } = await assessMacroOverlay(SAMPLE_NEWS, makeCandidate(), strategyConfig, makeLlm({
      macroBias: "neutral", confidenceScore: 8, btcRelevance: 7,
      catalystSummary: "Mixed signals.", riskFlags: [],
    }));
    expect(decision.action).toBe("pass");
  });
});

// ── candidate-aware: 同一批新闻下，long / short 可以有不同结果 ─────────────────

describe("assessMacroOverlay — candidate-aware 决策", () => {
  it("bearish + riskFlags 对 long 候选 → block", async () => {
    const { decision } = await assessMacroOverlay(
      SAMPLE_NEWS,
      makeCandidate({ direction: "long", signalGrade: "high-conviction" }),
      strategyConfig,
      makeLlm(bearishResponse(["FOMC meeting"]))
    );
    expect(decision.action).toBe("block");
  });

  it("bearish + riskFlags 对 short 候选 → downgrade，不会误杀顺风空头", async () => {
    const { decision } = await assessMacroOverlay(
      SAMPLE_NEWS,
      makeCandidate({ direction: "short", signalGrade: "high-conviction" }),
      strategyConfig,
      makeLlm(bearishResponse(["regulatory action"]))
    );
    expect(decision.action).toBe("downgrade");
    expect(decision.reasonCodes).toContain("EVENT_WINDOW_WATCH_ONLY");
    expect(decision.reasonCodes).toContain("MACRO_DOWNGRADED");
    expect(decision.reasonCodes).not.toContain("MACRO_BLOCKED");
  });

  it("bearish + 无 riskFlags 对 long 候选 → downgrade", async () => {
    const { decision } = await assessMacroOverlay(
      SAMPLE_NEWS,
      makeCandidate({ direction: "long" }),
      strategyConfig,
      makeLlm(bearishResponse([]))
    );
    expect(decision.action).toBe("downgrade");
    expect(decision.reasonCodes).toContain("MACRO_DOWNGRADED");
  });

  it("bearish + 无 riskFlags 对 short 候选 → pass", async () => {
    const { decision } = await assessMacroOverlay(
      SAMPLE_NEWS,
      makeCandidate({ direction: "short" }),
      strategyConfig,
      makeLlm(bearishResponse([]))
    );
    expect(decision.action).toBe("pass");
  });
});

// ── LLM 调用抛出异常 → 降级为 pass ───────────────────────────────────────────

describe("assessMacroOverlay — LLM 调用抛出异常", () => {
  it("llmCall 抛出 Error → action=pass（不崩溃）", async () => {
    const throwingLlm: LlmCallFn = async () => { throw new Error("Network timeout"); };
    const { decision } = await assessMacroOverlay(SAMPLE_NEWS, makeCandidate(), strategyConfig, throwingLlm);
    expect(decision.action).toBe("pass");
  });

  it("llmCall 抛出时 assessment.confidenceScore=0（中性）", async () => {
    const throwingLlm: LlmCallFn = async () => { throw new Error("API error"); };
    const { assessment } = await assessMacroOverlay(SAMPLE_NEWS, makeCandidate(), strategyConfig, throwingLlm);
    expect(assessment.confidenceScore).toBe(0);
    expect(assessment.macroBias).toBe("neutral");
  });

  it("llmCall 抛出时 reasonCodes 为空", async () => {
    const throwingLlm: LlmCallFn = async () => { throw new Error("Timeout"); };
    const { decision } = await assessMacroOverlay(SAMPLE_NEWS, makeCandidate(), strategyConfig, throwingLlm);
    expect(decision.reasonCodes).toHaveLength(0);
  });

  it("llmCall 抛出时会记录降级日志", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    const throwingLlm: LlmCallFn = async () => { throw new Error("Network timeout"); };
    await assessMacroOverlay(SAMPLE_NEWS, makeCandidate(), strategyConfig, throwingLlm);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "BTCUSDT",
        direction: "long",
        timeframe: "4h",
        fallbackAction: "pass",
      }),
      "Macro overlay LLM call failed; defaulting to pass"
    );
  });
});

// ── LLM 响应解析失败 → 降级为中性 pass ───────────────────────────────────────

describe("assessMacroOverlay — LLM 响应解析失败", () => {
  it("LLM 返回无效 JSON → assessment 中性，decision=pass", async () => {
    const badLlm: LlmCallFn = async () => "I cannot provide an assessment.";
    const { assessment, decision } = await assessMacroOverlay(SAMPLE_NEWS, makeCandidate(), strategyConfig, badLlm);
    expect(assessment.macroBias).toBe("neutral");
    expect(assessment.confidenceScore).toBe(0);
    expect(decision.action).toBe("pass"); // confidenceScore=0 < 7 → pass
  });
});

// ── 空新闻列表 ────────────────────────────────────────────────────────────────

describe("assessMacroOverlay — 空新闻列表", () => {
  it("空新闻 + bullish LLM → 正常返回 pass", async () => {
    const { decision } = await assessMacroOverlay([], makeCandidate(), strategyConfig, makeLlm(bullishResponse()));
    expect(decision.action).toBe("pass");
  });
});

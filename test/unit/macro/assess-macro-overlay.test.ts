import { describe, it, expect } from "vitest";
import { assessMacroOverlay } from "../../../src/services/macro/assess-macro-overlay.js";
import type { LlmCallFn } from "../../../src/services/macro/assess-macro-overlay.js";
import type { NewsItem } from "../../../src/domain/news/news-item.js";
import { strategyConfig } from "../../../src/app/config.js";

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

// ── MacroAssessment 透传 ───────────────────────────────────────────────────────

describe("assessMacroOverlay — assessment 透传", () => {
  it("assessment 包含 LLM 返回的原始 macroBias", async () => {
    const { assessment } = await assessMacroOverlay(SAMPLE_NEWS, strategyConfig, makeLlm(bullishResponse()));
    expect(assessment.macroBias).toBe("bullish");
    expect(assessment.confidenceScore).toBe(8);
  });

  it("assessment 包含 rawPrompt（非空字符串）", async () => {
    const { assessment } = await assessMacroOverlay(SAMPLE_NEWS, strategyConfig, makeLlm(bullishResponse()));
    expect(assessment.rawPrompt.length).toBeGreaterThan(0);
    expect(assessment.rawPrompt).toContain("Fed signals rate cuts");
  });
});

// ── 决策规则 a: 低置信度 → pass ──────────────────────────────────────────────

describe("assessMacroOverlay — 低置信度 → pass", () => {
  it("confidenceScore < minimumMacroConfidence(7) → action=pass", async () => {
    const { decision } = await assessMacroOverlay(SAMPLE_NEWS, strategyConfig, makeLlm(lowConfidenceResponse()));
    expect(decision.action).toBe("pass");
  });

  it("低置信度时 reasonCodes 为空", async () => {
    const { decision } = await assessMacroOverlay(SAMPLE_NEWS, strategyConfig, makeLlm(lowConfidenceResponse()));
    expect(decision.reasonCodes).toHaveLength(0);
  });
});

// ── 决策规则 b: 低 BTC 相关性 → pass ────────────────────────────────────────

describe("assessMacroOverlay — 低 BTC 相关性 → pass", () => {
  it("btcRelevance < minimumBtcRelevance(6) → action=pass", async () => {
    const { decision } = await assessMacroOverlay(SAMPLE_NEWS, strategyConfig, makeLlm(lowRelevanceResponse()));
    expect(decision.action).toBe("pass");
  });
});

// ── 决策规则 c: 看多 → pass ──────────────────────────────────────────────────

describe("assessMacroOverlay — macroBias=bullish → pass", () => {
  it("看多高置信度 → action=pass", async () => {
    const { decision } = await assessMacroOverlay(SAMPLE_NEWS, strategyConfig, makeLlm(bullishResponse()));
    expect(decision.action).toBe("pass");
  });

  it("看多 + riskFlags 非空 → action=pass，但包含 EVENT_WINDOW_WATCH_ONLY", async () => {
    const response = { ...bullishResponse(), riskFlags: ["FOMC meeting"] };
    const { decision } = await assessMacroOverlay(SAMPLE_NEWS, strategyConfig, makeLlm(response));
    expect(decision.action).toBe("pass");
    expect(decision.reasonCodes).toContain("EVENT_WINDOW_WATCH_ONLY");
  });

  it("中性 → action=pass", async () => {
    const { decision } = await assessMacroOverlay(SAMPLE_NEWS, strategyConfig, makeLlm({
      macroBias: "neutral", confidenceScore: 8, btcRelevance: 7,
      catalystSummary: "Mixed signals.", riskFlags: [],
    }));
    expect(decision.action).toBe("pass");
  });
});

// ── 决策规则 d: 看空 + riskFlags → block ─────────────────────────────────────

describe("assessMacroOverlay — 看空 + riskFlags → block", () => {
  it("bearish + riskFlags=[\"FOMC\"] → action=block", async () => {
    const { decision } = await assessMacroOverlay(
      SAMPLE_NEWS, strategyConfig, makeLlm(bearishResponse(["FOMC meeting"]))
    );
    expect(decision.action).toBe("block");
  });

  it("block 时 reasonCodes 包含 EVENT_WINDOW_WATCH_ONLY 和 MACRO_BLOCKED", async () => {
    const { decision } = await assessMacroOverlay(
      SAMPLE_NEWS, strategyConfig, makeLlm(bearishResponse(["regulatory action"]))
    );
    expect(decision.reasonCodes).toContain("EVENT_WINDOW_WATCH_ONLY");
    expect(decision.reasonCodes).toContain("MACRO_BLOCKED");
  });
});

// ── 决策规则 e: 看空 + 无 riskFlags → downgrade ──────────────────────────────

describe("assessMacroOverlay — 看空 + 无 riskFlags → downgrade", () => {
  it("bearish + riskFlags=[] → action=downgrade", async () => {
    const { decision } = await assessMacroOverlay(
      SAMPLE_NEWS, strategyConfig, makeLlm(bearishResponse([]))
    );
    expect(decision.action).toBe("downgrade");
  });

  it("downgrade 时 reasonCodes 包含 MACRO_DOWNGRADED", async () => {
    const { decision } = await assessMacroOverlay(
      SAMPLE_NEWS, strategyConfig, makeLlm(bearishResponse([]))
    );
    expect(decision.reasonCodes).toContain("MACRO_DOWNGRADED");
  });

  it("downgrade 时不包含 EVENT_WINDOW_WATCH_ONLY（无风险旗帜）", async () => {
    const { decision } = await assessMacroOverlay(
      SAMPLE_NEWS, strategyConfig, makeLlm(bearishResponse([]))
    );
    expect(decision.reasonCodes).not.toContain("EVENT_WINDOW_WATCH_ONLY");
  });
});

// ── LLM 响应解析失败 → 降级为中性 pass ───────────────────────────────────────

describe("assessMacroOverlay — LLM 响应解析失败", () => {
  it("LLM 返回无效 JSON → assessment 中性，decision=pass", async () => {
    const badLlm: LlmCallFn = async () => "I cannot provide an assessment.";
    const { assessment, decision } = await assessMacroOverlay(SAMPLE_NEWS, strategyConfig, badLlm);
    expect(assessment.macroBias).toBe("neutral");
    expect(assessment.confidenceScore).toBe(0);
    expect(decision.action).toBe("pass"); // confidenceScore=0 < 7 → pass
  });
});

// ── 空新闻列表 ────────────────────────────────────────────────────────────────

describe("assessMacroOverlay — 空新闻列表", () => {
  it("空新闻 + bullish LLM → 正常返回 pass", async () => {
    const { decision } = await assessMacroOverlay([], strategyConfig, makeLlm(bullishResponse()));
    expect(decision.action).toBe("pass");
  });
});

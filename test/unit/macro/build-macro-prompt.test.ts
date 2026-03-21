import { describe, it, expect } from "vitest";
import { buildMacroPrompt } from "../../../src/services/macro/build-macro-prompt.js";
import type { NewsItem } from "../../../src/domain/news/news-item.js";
import type { TradeCandidate } from "../../../src/domain/signal/trade-candidate.js";
import { strategyConfig } from "../../../src/app/config.js";

// strategyConfig.maxNewsItemsForPrompt = 10

function makeItem(i: number, category: "macro" | "crypto" = "macro"): NewsItem {
  return {
    id: `news-${i}`,
    source: "Reuters",
    publishedAt: "2026-03-20T10:00:00Z",
    title: `Headline ${i}`,
    category,
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
    riskReward: 2.8,
    regimeAligned: true,
    participantAligned: true,
    structureReason: "Bullish FVG reclaim near liquidity sweep",
    contextReason: "Regime: trend (75%) | Driver: new-longs (82%) | Participants: short-crowded / squeeze-risk (70%) | Session: london_ny_overlap",
    signalGrade: "high-conviction",
    reasonCodes: [],
    ...overrides,
  };
}

describe("buildMacroPrompt — 基础输出", () => {
  it("返回非空字符串", () => {
    const prompt = buildMacroPrompt([makeItem(1)], makeCandidate(), strategyConfig);
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(50);
  });

  it("包含新闻标题", () => {
    const prompt = buildMacroPrompt([makeItem(1)], makeCandidate(), strategyConfig);
    expect(prompt).toContain("Headline 1");
  });

  it("包含新闻类别（大写）", () => {
    const items = [makeItem(1, "crypto"), makeItem(2, "macro")];
    const prompt = buildMacroPrompt(items, makeCandidate(), strategyConfig);
    expect(prompt).toContain("[CRYPTO]");
    expect(prompt).toContain("[MACRO]");
  });

  it("包含日期（publishedAt 前 10 字符）", () => {
    const prompt = buildMacroPrompt([makeItem(1)], makeCandidate(), strategyConfig);
    expect(prompt).toContain("2026-03-20");
  });

  it("要求 JSON 输出格式（含 macroBias 字段）", () => {
    const prompt = buildMacroPrompt([makeItem(1)], makeCandidate(), strategyConfig);
    expect(prompt).toContain('"macroBias"');
    expect(prompt).toContain('"confidenceScore"');
    expect(prompt).toContain('"btcRelevance"');
    expect(prompt).toContain('"riskFlags"');
  });

  it("包含 candidate 摘要，但不暴露价格细节", () => {
    const prompt = buildMacroPrompt([makeItem(1)], makeCandidate(), strategyConfig);
    expect(prompt).toContain("Direction: long");
    expect(prompt).toContain("Signal grade: high-conviction");
    expect(prompt).toContain("Bullish FVG reclaim near liquidity sweep");
    expect(prompt).not.toContain("59800");
    expect(prompt).not.toContain("60000");
    expect(prompt).not.toContain("63000");
  });

  it("context summary 会去掉内部百分比", () => {
    const prompt = buildMacroPrompt([makeItem(1)], makeCandidate(), strategyConfig);
    expect(prompt).toContain("Regime: trend");
    expect(prompt).toContain("Driver: new-longs");
    expect(prompt).not.toContain("(75%)");
    expect(prompt).not.toContain("(82%)");
  });
});

describe("buildMacroPrompt — 截断逻辑", () => {
  it("超过 maxNewsItemsForPrompt(10) 的条目被截断", () => {
    const items = Array.from({ length: 15 }, (_, i) => makeItem(i));
    const prompt = buildMacroPrompt(items, makeCandidate(), strategyConfig);
    // 只有前 10 个出现：[1]..[10]，[11]..[15] 不应出现
    expect(prompt).toContain("Headline 9"); // 0-indexed: item index 9 = i=9 → Headline 9
    expect(prompt).not.toContain("Headline 10"); // i=10 → Headline 10, should be cut
  });

  it("maxNewsItemsForPrompt=2 时只显示前 2 条", () => {
    const config = { ...strategyConfig, maxNewsItemsForPrompt: 2 };
    const items = [makeItem(1), makeItem(2), makeItem(3)];
    const prompt = buildMacroPrompt(items, makeCandidate(), config);
    expect(prompt).toContain("Headline 1");
    expect(prompt).toContain("Headline 2");
    expect(prompt).not.toContain("Headline 3");
  });
});

describe("buildMacroPrompt — 无新闻", () => {
  it("空数组 → 仍返回合法 prompt，含 no recent news 占位符", () => {
    const prompt = buildMacroPrompt([], makeCandidate(), strategyConfig);
    expect(prompt).toContain("no recent news");
  });

  it("空数组 → 仍包含 JSON 输出指令", () => {
    const prompt = buildMacroPrompt([], makeCandidate(), strategyConfig);
    expect(prompt).toContain('"macroBias"');
  });
});

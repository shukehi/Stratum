import { describe, it, expect } from "vitest";
import { parseMacroResponse } from "../../../src/services/macro/parse-macro-response.js";

const PROMPT = "test prompt";

function validJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    macroBias: "bearish",
    confidenceScore: 8,
    btcRelevance: 7,
    catalystSummary: "Fed hawkish signals weigh on risk assets.",
    riskFlags: ["FOMC meeting"],
    ...overrides,
  });
}

// ── 成功路径 ────────────────────────────────────────────────────────────────

describe("parseMacroResponse — 有效 JSON", () => {
  it("标准 bearish 响应 → 正确映射所有字段", () => {
    const result = parseMacroResponse(PROMPT, validJson());
    expect(result.macroBias).toBe("bearish");
    expect(result.confidenceScore).toBe(8);
    expect(result.btcRelevance).toBe(7);
    expect(result.catalystSummary).toBe("Fed hawkish signals weigh on risk assets.");
    expect(result.riskFlags).toEqual(["FOMC meeting"]);
    expect(result.rawPrompt).toBe(PROMPT);
    expect(result.rawResponse).toBe(validJson());
  });

  it("macroBias=bullish → 正确映射", () => {
    const result = parseMacroResponse(PROMPT, validJson({ macroBias: "bullish" }));
    expect(result.macroBias).toBe("bullish");
  });

  it("macroBias=neutral → 正确映射", () => {
    const result = parseMacroResponse(PROMPT, validJson({ macroBias: "neutral" }));
    expect(result.macroBias).toBe("neutral");
  });

  it("riskFlags=[] → 空数组（不是 null）", () => {
    const result = parseMacroResponse(PROMPT, validJson({ riskFlags: [] }));
    expect(result.riskFlags).toEqual([]);
  });

  it("riskFlags 包含非 string 元素 → 过滤掉", () => {
    const result = parseMacroResponse(PROMPT, validJson({ riskFlags: ["valid", 42, null, "also-valid"] }));
    expect(result.riskFlags).toEqual(["valid", "also-valid"]);
  });
});

// ── 数值钳制 ────────────────────────────────────────────────────────────────

describe("parseMacroResponse — 数值钳制 [0, 10]", () => {
  it("confidenceScore=15 → 钳制为 10", () => {
    const result = parseMacroResponse(PROMPT, validJson({ confidenceScore: 15 }));
    expect(result.confidenceScore).toBe(10);
  });

  it("confidenceScore=-3 → 钳制为 0", () => {
    const result = parseMacroResponse(PROMPT, validJson({ confidenceScore: -3 }));
    expect(result.confidenceScore).toBe(0);
  });

  it("btcRelevance=11 → 钳制为 10", () => {
    const result = parseMacroResponse(PROMPT, validJson({ btcRelevance: 11 }));
    expect(result.btcRelevance).toBe(10);
  });

  it("confidenceScore=7.6 → 四舍五入为 8", () => {
    const result = parseMacroResponse(PROMPT, validJson({ confidenceScore: 7.6 }));
    expect(result.confidenceScore).toBe(8);
  });
});

// ── Markdown 代码围栏剥离 ──────────────────────────────────────────────────

describe("parseMacroResponse — Markdown 围栏剥离", () => {
  it("```json ... ``` 围栏被自动剥离", () => {
    const raw = "```json\n" + validJson() + "\n```";
    const result = parseMacroResponse(PROMPT, raw);
    expect(result.macroBias).toBe("bearish"); // 解析成功
    expect(result.confidenceScore).toBe(8);
  });

  it("``` ... ``` 围栏（无语言标记）被自动剥离", () => {
    const raw = "```\n" + validJson() + "\n```";
    const result = parseMacroResponse(PROMPT, raw);
    expect(result.macroBias).toBe("bearish");
  });
});

// ── 容错路径 ─────────────────────────────────────────────────────────────────

describe("parseMacroResponse — 容错降级为中性", () => {
  it("无效 JSON → 中性 assessment（confidenceScore=0）", () => {
    const result = parseMacroResponse(PROMPT, "not json at all");
    expect(result.macroBias).toBe("neutral");
    expect(result.confidenceScore).toBe(0);
    expect(result.btcRelevance).toBe(0);
    expect(result.riskFlags).toEqual([]);
  });

  it("空字符串 → 中性", () => {
    const result = parseMacroResponse(PROMPT, "");
    expect(result.macroBias).toBe("neutral");
  });

  it("macroBias 不在枚举 (\"unknown\") → 中性", () => {
    const result = parseMacroResponse(PROMPT, validJson({ macroBias: "unknown" }));
    expect(result.macroBias).toBe("neutral");
    expect(result.confidenceScore).toBe(0);
  });

  it("缺少 catalystSummary 字段 → 中性", () => {
    const obj = JSON.parse(validJson());
    delete obj.catalystSummary;
    const result = parseMacroResponse(PROMPT, JSON.stringify(obj));
    expect(result.macroBias).toBe("neutral");
  });

  it("riskFlags 不是数组 → 中性", () => {
    const result = parseMacroResponse(PROMPT, validJson({ riskFlags: "single string" }));
    expect(result.macroBias).toBe("neutral");
  });

  it("rawPrompt / rawResponse 原样透传（即使降级为中性）", () => {
    const result = parseMacroResponse("my-prompt", "bad-json");
    expect(result.rawPrompt).toBe("my-prompt");
    expect(result.rawResponse).toBe("bad-json");
  });
});

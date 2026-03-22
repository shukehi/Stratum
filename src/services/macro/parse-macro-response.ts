import type { MacroAssessment } from "../../domain/macro/macro-assessment.js";

/**
 * LLM 响应解析器  (PHASE_07)
 *
 * 职责:
 *   将 LLM 返回的原始字符串解析为 MacroAssessment。
 *
 * 容错策略:
 *   - 自动剥离 Markdown 代码围栏 (```json ... ```)
 *   - JSON 解析失败 → 返回中性 Assessment（confidenceScore=0, btcRelevance=0）
 *   - 字段缺失或类型错误 → 返回中性 Assessment
 *   - macroBias 不在合法枚举 → 返回中性 Assessment
 *   - confidenceScore / btcRelevance 钳制到 [0, 10]（取整）
 *   - riskFlags 只保留 string 类型元素
 *
 * 不允许:
 *   - 访问网络或 LLM
 *   - 修改 rawPrompt / rawResponse（原样透传）
 */

type LlmJson = {
  macroBias: unknown;
  confidenceScore: unknown;
  btcRelevance: unknown;
  catalystSummary: unknown;
  riskFlags: unknown;
};

const VALID_BIASES = new Set(["bullish", "bearish", "neutral"]);

function neutralAssessment(rawPrompt: string, rawResponse: string): MacroAssessment {
  return {
    macroBias: "neutral",
    confidenceScore: 0,
    btcRelevance: 0,
    catalystSummary: "无法解析 LLM 响应，默认中性评估",
    riskFlags: [],
    rawPrompt,
    rawResponse,
  };
}

function clampInt(v: unknown, lo = 0, hi = 10): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!isFinite(n)) return 0;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

export function parseMacroResponse(rawPrompt: string, rawResponse: string): MacroAssessment {
  // 如果响应包在 Markdown 代码块里，先剥离围栏再解析
  const cleaned = rawResponse
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  let parsed: LlmJson;
  try {
    parsed = JSON.parse(cleaned) as LlmJson;
  } catch {
    return neutralAssessment(rawPrompt, rawResponse);
  }

  // 校验必填字段是否存在且类型正确
  if (
    typeof parsed.macroBias !== "string" ||
    !VALID_BIASES.has(parsed.macroBias) ||
    typeof parsed.catalystSummary !== "string" ||
    !Array.isArray(parsed.riskFlags)
  ) {
    return neutralAssessment(rawPrompt, rawResponse);
  }

  return {
    macroBias: parsed.macroBias as "bullish" | "bearish" | "neutral",
    confidenceScore: clampInt(parsed.confidenceScore),
    btcRelevance: clampInt(parsed.btcRelevance),
    catalystSummary: parsed.catalystSummary,
    riskFlags: (parsed.riskFlags as unknown[]).filter((f): f is string => typeof f === "string"),
    rawPrompt,
    rawResponse,
  };
}

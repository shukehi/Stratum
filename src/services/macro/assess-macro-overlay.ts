import type { NewsItem } from "../../domain/news/news-item.js";
import type { MacroAssessment, MacroOverlayDecision } from "../../domain/macro/macro-assessment.js";
import type { ReasonCode } from "../../domain/common/reason-code.js";
import type { StrategyConfig } from "../../app/config.js";
import { buildMacroPrompt } from "./build-macro-prompt.js";
import { parseMacroResponse } from "./parse-macro-response.js";

/**
 * LLM 调用接口  (PHASE_07)
 *
 * 注入式设计：生产环境传入真实 Anthropic/OpenAI 调用；单元测试传入 mock fn。
 * 接收 prompt 字符串，返回 LLM 原始文本响应。
 */
export type LlmCallFn = (prompt: string) => Promise<string>;

/**
 * 宏观覆盖层编排器  (PHASE_07)
 *
 * 职责:
 *   1. 用 config.maxNewsItemsForPrompt 截断新闻列表
 *   2. buildMacroPrompt → 构造 prompt
 *   3. llmCall(prompt)  → 获取 LLM 原始响应
 *   4. parseMacroResponse → 生成 MacroAssessment
 *   5. deriveDecision    → 从 Assessment 推导 MacroOverlayDecision
 *
 * 决策逻辑（第一性原理，守序应用）:
 *   a. confidenceScore < minimumMacroConfidence (7)  → pass（信号不足）
 *   b. btcRelevance    < minimumBtcRelevance (6)      → pass（与 BTC 无关）
 *   c. macroBias = "bullish" | "neutral"              → pass
 *   d. macroBias = "bearish" + riskFlags.length > 0   → block
 *      + reasonCodes: [EVENT_WINDOW_WATCH_ONLY, MACRO_BLOCKED]
 *   e. macroBias = "bearish" + riskFlags.length === 0 → downgrade
 *      + reasonCodes: [MACRO_DOWNGRADED]
 *
 *   注: 规则 c-e 中，若 riskFlags 非空，无论最终 action 如何，均附加
 *       EVENT_WINDOW_WATCH_ONLY（上游调用方可据此降级为仅观察）。
 *
 * 禁止:
 *   - 不修改 TradeCandidate（由 apply-macro-overlay 负责）
 *   - 不持久化数据
 */
export async function assessMacroOverlay(
  news: NewsItem[],
  config: StrategyConfig,
  llmCall: LlmCallFn
): Promise<{ assessment: MacroAssessment; decision: MacroOverlayDecision }> {
  const prompt = buildMacroPrompt(news, config);
  const rawResponse = await llmCall(prompt);
  const assessment = parseMacroResponse(prompt, rawResponse);
  const decision = deriveDecision(assessment, config);
  return { assessment, decision };
}

// ── 内部辅助 ──────────────────────────────────────────────────────────────────

function deriveDecision(
  assessment: MacroAssessment,
  config: StrategyConfig
): MacroOverlayDecision {
  const { confidenceScore, btcRelevance, macroBias, catalystSummary, riskFlags } = assessment;

  // ── a. 置信度不足 → pass ─────────────────────────────────────────────────
  if (confidenceScore < config.minimumMacroConfidence) {
    return {
      action: "pass",
      confidence: confidenceScore,
      reason: catalystSummary,
      reasonCodes: [],
    };
  }

  // ── b. BTC 相关性不足 → pass ─────────────────────────────────────────────
  if (btcRelevance < config.minimumBtcRelevance) {
    return {
      action: "pass",
      confidence: confidenceScore,
      reason: catalystSummary,
      reasonCodes: [],
    };
  }

  // ── 公共 reasonCodes：事件窗口标记 ──────────────────────────────────────
  const reasonCodes: ReasonCode[] = [];
  if (riskFlags.length > 0) {
    reasonCodes.push("EVENT_WINDOW_WATCH_ONLY");
  }

  // ── c. 看多 / 中性 → pass ───────────────────────────────────────────────
  if (macroBias === "bullish" || macroBias === "neutral") {
    return {
      action: "pass",
      confidence: confidenceScore,
      reason: catalystSummary,
      reasonCodes,
    };
  }

  // ── d & e. 看空分支 ─────────────────────────────────────────────────────
  if (riskFlags.length > 0) {
    // d. 看空 + 风险旗帜 → block
    reasonCodes.push("MACRO_BLOCKED");
    return {
      action: "block",
      confidence: confidenceScore,
      reason: catalystSummary,
      reasonCodes,
    };
  }

  // e. 看空 + 无风险旗帜 → downgrade
  reasonCodes.push("MACRO_DOWNGRADED");
  return {
    action: "downgrade",
    confidence: confidenceScore,
    reason: catalystSummary,
    reasonCodes,
  };
}

import type { NewsItem } from "../../domain/news/news-item.js";
import type { MacroAssessment, MacroOverlayDecision } from "../../domain/macro/macro-assessment.js";
import type { ReasonCode } from "../../domain/common/reason-code.js";
import type { TradeCandidate } from "../../domain/signal/trade-candidate.js";
import type { StrategyConfig } from "../../app/config.js";
import { logger } from "../../app/logger.js";
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
 * 决策逻辑（第一性原理，逐 candidate）:
 *   a. confidenceScore < minimumMacroConfidence (7)  → pass（信号不足）
 *   b. btcRelevance    < minimumBtcRelevance (6)      → pass（与 BTC 无关）
 *   c. macroBias 与 candidate.direction 同向         → pass
 *   d. macroBias 与 candidate.direction 逆向         → downgrade
 *   e. 若存在 riskFlags，则同向机会降级为 watch-only，逆向机会在非 watch 级时 block
 *
 *   注:
 *   - riskFlags 非空时始终附加 EVENT_WINDOW_WATCH_ONLY
 *   - watch 级机会不会因为宏观事件窗口被直接删除
 *
 * 禁止:
 *   - 不修改 TradeCandidate（由 apply-macro-overlay 负责）
 *   - 不持久化数据
 */
export async function assessMacroOverlay(
  news: NewsItem[],
  candidate: TradeCandidate,
  config: StrategyConfig,
  llmCall: LlmCallFn
): Promise<{ assessment: MacroAssessment; decision: MacroOverlayDecision }> {
  const prompt = buildMacroPrompt(news, candidate, config);
  const startedAt = Date.now();

  let rawResponse: string;
  try {
    rawResponse = await llmCall(prompt);
  } catch (error) {
    // LLM 调用失败（网络超时 / API 错误）→ 降级为中性，默认 pass
    const assessment = parseMacroResponse(prompt, "");
    const decision: MacroOverlayDecision = {
      action: "pass",
      confidence: 0,
      reason: "LLM 调用失败，无法获取宏观评估，默认通过",
      reasonCodes: [],
    };
    logger.warn(
      {
        symbol: candidate.symbol,
        direction: candidate.direction,
        timeframe: candidate.timeframe,
        elapsedMs: Date.now() - startedAt,
        err: error,
        fallbackAction: decision.action,
      },
      "Macro overlay LLM call failed; defaulting to pass"
    );
    return { assessment, decision };
  }

  const assessment = parseMacroResponse(prompt, rawResponse);
  const decision = deriveDecision(assessment, candidate, config);
  logger.info(
    {
      symbol: candidate.symbol,
      direction: candidate.direction,
      timeframe: candidate.timeframe,
      elapsedMs: Date.now() - startedAt,
      macroBias: assessment.macroBias,
      confidenceScore: assessment.confidenceScore,
      btcRelevance: assessment.btcRelevance,
      riskFlags: assessment.riskFlags.length,
      action: decision.action,
    },
    "Macro overlay assessment completed"
  );
  return { assessment, decision };
}

// ── 内部辅助 ──────────────────────────────────────────────────────────────────

function deriveDecision(
  assessment: MacroAssessment,
  candidate: TradeCandidate,
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

  const reasonCodes: ReasonCode[] = [];
  const hasEventRisk = riskFlags.length > 0;
  if (hasEventRisk) {
    reasonCodes.push("EVENT_WINDOW_WATCH_ONLY");
  }

  if (macroBias === "neutral") {
    return hasEventRisk
      ? makeDecision("downgrade", confidenceScore, catalystSummary, reasonCodes, "MACRO_DOWNGRADED")
      : makeDecision("pass", confidenceScore, catalystSummary, reasonCodes);
  }

  const aligned =
    (macroBias === "bullish" && candidate.direction === "long") ||
    (macroBias === "bearish" && candidate.direction === "short");

  if (aligned) {
    return hasEventRisk
      ? makeDecision("downgrade", confidenceScore, catalystSummary, reasonCodes, "MACRO_DOWNGRADED")
      : makeDecision("pass", confidenceScore, catalystSummary, reasonCodes);
  }

  if (hasEventRisk && candidate.signalGrade !== "watch") {
    return makeDecision("block", confidenceScore, catalystSummary, reasonCodes, "MACRO_BLOCKED");
  }

  return makeDecision("downgrade", confidenceScore, catalystSummary, reasonCodes, "MACRO_DOWNGRADED");
}

function makeDecision(
  action: MacroOverlayDecision["action"],
  confidence: number,
  reason: string,
  reasonCodes: ReasonCode[],
  extraCode?: ReasonCode
): MacroOverlayDecision {
  return {
    action,
    confidence,
    reason,
    reasonCodes: extraCode
      ? [...new Set([...reasonCodes, extraCode])]
      : [...new Set(reasonCodes)],
  };
}

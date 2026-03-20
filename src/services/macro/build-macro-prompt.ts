import type { NewsItem } from "../../domain/news/news-item.js";
import type { StrategyConfig } from "../../app/config.js";

/**
 * 宏观 Prompt 构造器  (PHASE_07)
 *
 * 职责:
 *   将 NewsItem[] 格式化为结构化 LLM Prompt，指定输出格式为 JSON。
 *
 * 规则:
 *   - 输入条目上限 = config.maxNewsItemsForPrompt（超出部分截断，不报错）
 *   - 无新闻时仍返回合法 Prompt，LLM 应返回 neutral / 低置信度
 *   - 输出格式为纯 JSON（不含 Markdown 代码块），由 parse-macro-response 负责解析
 *
 * 不允许:
 *   - 访问网络
 *   - 返回 MacroAssessment（职责在 parse-macro-response）
 */
export function buildMacroPrompt(items: NewsItem[], config: StrategyConfig): string {
  const capped = items.slice(0, config.maxNewsItemsForPrompt);

  const newsBlock =
    capped.length > 0
      ? capped
          .map(
            (item, i) =>
              `[${i + 1}] [${item.category.toUpperCase()}] ${item.publishedAt.slice(0, 10)} — ${item.title}`
          )
          .join("\n")
      : "(no recent news headlines available)";

  return `You are a senior macro analyst assessing the current market environment for Bitcoin (BTC) swing trading decisions.

Review the following recent news headlines and provide a structured assessment:

${newsBlock}

Respond ONLY with a valid JSON object (no markdown code fences, no explanation outside the JSON) in this exact format:
{
  "macroBias": "<bullish|bearish|neutral>",
  "confidenceScore": <integer 0-10>,
  "btcRelevance": <integer 0-10>,
  "catalystSummary": "<1-2 sentence summary of the key macro catalyst driving your assessment>",
  "riskFlags": ["<upcoming event or risk>"]
}

Scoring guide:
- confidenceScore: How confident you are in the directional bias (0 = no clear signal, 10 = very strong clear signal)
- btcRelevance: How directly relevant these events are to BTC price action (0 = irrelevant, 10 = highly relevant)
- riskFlags: List any major upcoming scheduled events or sudden risks (e.g. "FOMC meeting", "CPI release", "regulatory action", "exchange hack"). Use empty array [] if none.

Important:
- If news is ambiguous, mixed, or unrelated to BTC/crypto/macro, return "neutral" with low scores.
- Be conservative: avoid "high-conviction" bearish calls unless evidence is clear.
- Do NOT include any text outside the JSON object.`;
}

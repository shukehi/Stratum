import type { LlmCallFn } from "../../services/macro/assess-macro-overlay.js";
import { logger } from "../../app/logger.js";

/**
 * LLM 客户端工厂  (PHASE_07 扩展)
 *
 * 支持两种 provider：
 *   - anthropic   : Anthropic Messages API（默认）
 *   - openrouter  : OpenRouter Chat Completions API（OpenAI 兼容格式）
 *
 * 环境变量：
 *   LLM_API_KEY   - API Key（必填，否则跳过 LLM 调用）
 *   LLM_PROVIDER  - "anthropic" | "openrouter"（默认: anthropic）
 *   LLM_MODEL     - 模型名称（可选，不填则使用 provider 默认值）
 *
 * OpenRouter 默认模型: google/gemini-2.0-flash-001
 * Anthropic  默认模型: claude-3-haiku-20240307
 */

// ── Provider 默认模型 ─────────────────────────────────────────────────────────

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-3-haiku-20240307",
  openrouter: "google/gemini-2.0-flash-001",
};

// ── Anthropic Messages API ────────────────────────────────────────────────────

async function callAnthropic(
  prompt: string,
  apiKey: string,
  model: string
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API HTTP ${res.status}: ${res.statusText}`);
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; text: string }>;
  };
  return data.content.find((c) => c.type === "text")?.text ?? "";
}

// ── OpenRouter Chat Completions API（OpenAI 兼容）─────────────────────────────

async function callOpenRouter(
  prompt: string,
  apiKey: string,
  model: string
): Promise<string> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "https://github.com/stratum-trading/stratum",
      "X-Title": "Stratum Trading Bot",
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenRouter API HTTP ${res.status}: ${res.statusText} — ${body}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices[0]?.message?.content ?? "";
}

// ── 工厂函数 ─────────────────────────────────────────────────────────────────

export interface LlmClientConfig {
  apiKey?: string;
  provider: "anthropic" | "openrouter";
  model?: string;
}

/**
 * 创建 LlmCallFn 实例。
 *
 * - apiKey 未设置时返回 no-op（空字符串），assess-macro-overlay 会 pass 降级。
 * - 请求失败时抛出错误（由 assess-macro-overlay catch 处理）。
 */
export function createLlmClient(config: LlmClientConfig): LlmCallFn {
  const { apiKey, provider, model } = config;
  const resolvedModel = model || DEFAULT_MODELS[provider] || DEFAULT_MODELS.anthropic;

  if (!apiKey) {
    logger.warn({ provider }, "LLM_API_KEY not set, skipping macro LLM call");
    return async () => "";
  }

  logger.info({ provider, model: resolvedModel }, "LLM client initialized");

  return async (prompt: string): Promise<string> => {
    const startedAt = Date.now();
    logger.info(
      {
        provider,
        model: resolvedModel,
        promptChars: prompt.length,
      },
      "LLM request started"
    );

    try {
      const response =
        provider === "openrouter"
          ? await callOpenRouter(prompt, apiKey, resolvedModel)
          : await callAnthropic(prompt, apiKey, resolvedModel);

      logger.info(
        {
          provider,
          model: resolvedModel,
          elapsedMs: Date.now() - startedAt,
          responseChars: response.length,
        },
        "LLM request succeeded"
      );
      return response;
    } catch (error) {
      logger.error(
        {
          provider,
          model: resolvedModel,
          elapsedMs: Date.now() - startedAt,
          err: error,
        },
        "LLM request failed"
      );
      throw error;
    }
  };
}

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLlmClient } from "../../../src/clients/llm/llm-client.js";

// ── 测试夹具 ──────────────────────────────────────────────────────────────────

const MOCK_PROMPT = "分析当前 BTC 宏观环境";

// ── no-op（未设置 API Key）────────────────────────────────────────────────────

describe("createLlmClient — apiKey 未设置", () => {
  it("返回空字符串，不发起任何 HTTP 请求", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const llmCall = createLlmClient({ apiKey: undefined, provider: "anthropic" });
    const result = await llmCall(MOCK_PROMPT);
    expect(result).toBe("");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("openrouter provider 也返回空字符串", async () => {
    const llmCall = createLlmClient({ apiKey: undefined, provider: "openrouter" });
    expect(await llmCall(MOCK_PROMPT)).toBe("");
  });
});

// ── Anthropic provider ────────────────────────────────────────────────────────

describe("createLlmClient — anthropic", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("发请求到 api.anthropic.com，携带正确 headers", async () => {
    const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "宏观看空" }],
      }),
    } as Response);

    const llmCall = createLlmClient({ apiKey: "sk-ant-test", provider: "anthropic" });
    const result = await llmCall(MOCK_PROMPT);

    expect(result).toBe("宏观看空");
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("使用指定 model", async () => {
    const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "ok" }] }),
    } as Response);

    const llmCall = createLlmClient({
      apiKey: "sk-ant-test",
      provider: "anthropic",
      model: "claude-3-5-sonnet-20241022",
    });
    await llmCall(MOCK_PROMPT);

    const body = JSON.parse((mockFetch.mock.calls[0][1]?.body as string) ?? "{}");
    expect(body.model).toBe("claude-3-5-sonnet-20241022");
  });

  it("model 未指定时使用默认值 claude-3-haiku-20240307", async () => {
    const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "ok" }] }),
    } as Response);

    const llmCall = createLlmClient({ apiKey: "sk-ant-test", provider: "anthropic" });
    await llmCall(MOCK_PROMPT);

    const body = JSON.parse((mockFetch.mock.calls[0][1]?.body as string) ?? "{}");
    expect(body.model).toBe("claude-3-haiku-20240307");
  });

  it("HTTP 非 200 时抛出错误", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    } as Response);

    const llmCall = createLlmClient({ apiKey: "bad-key", provider: "anthropic" });
    await expect(llmCall(MOCK_PROMPT)).rejects.toThrow("Anthropic API HTTP 401");
  });

  it("content 为空时返回空字符串", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ content: [] }),
    } as Response);

    const llmCall = createLlmClient({ apiKey: "sk-ant-test", provider: "anthropic" });
    expect(await llmCall(MOCK_PROMPT)).toBe("");
  });
});

// ── OpenRouter provider ───────────────────────────────────────────────────────

describe("createLlmClient — openrouter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("发请求到 openrouter.ai，携带 Bearer token", async () => {
    const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "中性，可以开仓" } }],
      }),
    } as Response);

    const llmCall = createLlmClient({ apiKey: "or-key-test", provider: "openrouter" });
    const result = await llmCall(MOCK_PROMPT);

    expect(result).toBe("中性，可以开仓");
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer or-key-test");
  });

  it("使用指定 model", async () => {
    const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    } as Response);

    const llmCall = createLlmClient({
      apiKey: "or-key-test",
      provider: "openrouter",
      model: "anthropic/claude-3.5-sonnet",
    });
    await llmCall(MOCK_PROMPT);

    const body = JSON.parse((mockFetch.mock.calls[0][1]?.body as string) ?? "{}");
    expect(body.model).toBe("anthropic/claude-3.5-sonnet");
  });

  it("model 未指定时使用默认值 google/gemini-flash-1.5", async () => {
    const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    } as Response);

    const llmCall = createLlmClient({ apiKey: "or-key-test", provider: "openrouter" });
    await llmCall(MOCK_PROMPT);

    const body = JSON.parse((mockFetch.mock.calls[0][1]?.body as string) ?? "{}");
    expect(body.model).toBe("google/gemini-flash-1.5");
  });

  it("请求体使用 OpenAI chat completions 格式", async () => {
    const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    } as Response);

    const llmCall = createLlmClient({ apiKey: "or-key-test", provider: "openrouter" });
    await llmCall(MOCK_PROMPT);

    const body = JSON.parse((mockFetch.mock.calls[0][1]?.body as string) ?? "{}");
    expect(body.messages).toEqual([{ role: "user", content: MOCK_PROMPT }]);
    expect(body.max_tokens).toBe(512);
  });

  it("HTTP 非 200 时抛出含状态码的错误", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: async () => '{"error":"rate limit exceeded"}',
    } as Response);

    const llmCall = createLlmClient({ apiKey: "or-key-test", provider: "openrouter" });
    await expect(llmCall(MOCK_PROMPT)).rejects.toThrow("OpenRouter API HTTP 429");
  });

  it("choices 为空时返回空字符串", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [] }),
    } as Response);

    const llmCall = createLlmClient({ apiKey: "or-key-test", provider: "openrouter" });
    expect(await llmCall(MOCK_PROMPT)).toBe("");
  });
});

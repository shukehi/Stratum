import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LiquiditySession } from "../../../src/domain/market/market-context.js";

// ── mock 当前时段检测 ──────────────────────────────────────────────────────────
vi.mock("../../../src/utils/session.js", () => ({
  getCurrentSession: vi.fn(),
  detectLiquiditySession: vi.fn(),
}));

// ── mock fetch（Telegram HTTP 调用）────────────────────────────────────────────
const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
vi.stubGlobal("fetch", mockFetch);

import { getCurrentSession } from "../../../src/utils/session.js";
import { monitorSession } from "../../../src/services/session/monitor-session.js";

const mockedGetCurrentSession = vi.mocked(getCurrentSession);

const telegramConfig = { botToken: "test-token", chatId: "test-chat" };
const notificationConfig = { telegram: telegramConfig };

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({ ok: true, text: async () => "" });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("monitorSession — 首次初始化", () => {
  it("lastSession=null 时返回当前时段，不发送 Telegram", async () => {
    mockedGetCurrentSession.mockReturnValue("london_ny_overlap");

    const result = await monitorSession(null, notificationConfig);

    expect(result).toBe("london_ny_overlap");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("无 telegramConfig 时首次调用也不报错", async () => {
    mockedGetCurrentSession.mockReturnValue("asian_low");
    const result = await monitorSession(null, undefined);
    expect(result).toBe("asian_low");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("monitorSession — 时段未变化", () => {
  it("时段相同时不发送 Telegram，返回相同时段", async () => {
    mockedGetCurrentSession.mockReturnValue("ny_close");

    const result = await monitorSession("ny_close", notificationConfig);

    expect(result).toBe("ny_close");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("monitorSession — 时段切换", () => {
  const transitions: Array<[LiquiditySession, LiquiditySession]> = [
    ["asian_low", "london_ramp"],
    ["london_ramp", "london_ny_overlap"],
    ["london_ny_overlap", "ny_close"],
    ["ny_close", "asian_low"],
  ];

  for (const [from, to] of transitions) {
    it(`${from} → ${to} 时发送 Telegram 并返回新时段`, async () => {
      mockedGetCurrentSession.mockReturnValue(to);

      const result = await monitorSession(from, notificationConfig);

      expect(result).toBe(to);
      expect(mockFetch).toHaveBeenCalledOnce();

      const call = mockFetch.mock.calls[0];
      const url = call[0] as string;
      const body = JSON.parse((call[1] as RequestInit).body as string);

      expect(url).toContain("test-token");
      expect(url).toContain("sendMessage");
      expect(body.chat_id).toBe("test-chat");
      expect(body.parse_mode).toBe("Markdown");
      // 消息包含时段名称
      expect(body.text).toContain("开启");
    });
  }

  it("Telegram 请求失败时不抛出异常，仍返回新时段", async () => {
    mockedGetCurrentSession.mockReturnValue("london_ramp");
    mockFetch.mockResolvedValue({ ok: false, text: async () => "Bad Request" });

    const result = await monitorSession("asian_low", notificationConfig);

    expect(result).toBe("london_ramp");
    // 不抛出异常
  });

  it("无 telegramConfig 时切换也不发送 Telegram，返回新时段", async () => {
    mockedGetCurrentSession.mockReturnValue("london_ny_overlap");

    const result = await monitorSession("london_ramp", undefined);

    expect(result).toBe("london_ny_overlap");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("monitorSession — Telegram 消息内容校验", () => {
  it("london_ny_overlap 开启消息包含正确的 UTC 和北京时间", async () => {
    mockedGetCurrentSession.mockReturnValue("london_ny_overlap");

    await monitorSession("london_ramp", notificationConfig);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toContain("08:00");   // UTC 开盘
    expect(body.text).toContain("16:00");   // 北京开盘
    expect(body.text).toContain("16:00");   // UTC 收盘
    expect(body.text).toContain("伦敦/纽约重叠");
  });

  it("asian_low 开启消息包含折扣警告", async () => {
    mockedGetCurrentSession.mockReturnValue("asian_low");

    await monitorSession("ny_close", notificationConfig);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toContain("亚洲盘");
    expect(body.text).toContain("折扣");
  });
});

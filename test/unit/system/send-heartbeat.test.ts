import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initDb } from "../../../src/services/persistence/init-db.js";
import { initPositionsDb } from "../../../src/services/positions/init-positions-db.js";

// ── mock fetch ────────────────────────────────────────────────────────────────
const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
vi.stubGlobal("fetch", mockFetch);

import { sendHeartbeat } from "../../../src/services/system/send-heartbeat.js";

// ── 测试辅助 ──────────────────────────────────────────────────────────────────

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  initDb(db);
  initPositionsDb(db);
  return db;
}

const telegramConfig = { botToken: "test-token", chatId: "test-chat" };
const notificationConfig = { telegram: telegramConfig };

const baseOpts = {
  version: "0.13.0",
  startedAt: Date.now() - 2 * 60 * 60 * 1000, // 2 小时前启动
  currentSession: "london_ny_overlap" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({ ok: true, text: async () => "" });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("sendHeartbeat — 基本功能", () => {
  it("正常运行时发送 Telegram 消息", async () => {
    const db = makeDb();
    await sendHeartbeat(db, notificationConfig, baseOpts);

    expect(mockFetch).toHaveBeenCalledOnce();
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("test-token");
    expect(url).toContain("sendMessage");
  });

  it("无 botToken 时不发送 Telegram", async () => {
    const db = makeDb();
    await sendHeartbeat(db, {}, baseOpts);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("Telegram 失败时不抛出异常", async () => {
    const db = makeDb();
    mockFetch.mockResolvedValue({ ok: false, text: async () => "Bad Request" });
    await expect(sendHeartbeat(db, notificationConfig, baseOpts)).resolves.not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("sendHeartbeat — 消息内容", () => {
  it("消息包含版本号", async () => {
    const db = makeDb();
    await sendHeartbeat(db, notificationConfig, baseOpts);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toContain("0.13.0");
  });

  it("消息包含运行时长", async () => {
    const db = makeDb();
    await sendHeartbeat(db, notificationConfig, baseOpts);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // 约 2 小时运行
    expect(body.text).toMatch(/运行时长.+\d+h/);
  });

  it("消息包含当前时段名称", async () => {
    const db = makeDb();
    await sendHeartbeat(db, notificationConfig, baseOpts);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toContain("伦敦/纽约重叠");
  });

  it("currentSession=null 时显示占位符", async () => {
    const db = makeDb();
    await sendHeartbeat(db, notificationConfig, { ...baseOpts, currentSession: null });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toContain("–");
  });

  it("无持仓时显示'当前无持仓'", async () => {
    const db = makeDb();
    await sendHeartbeat(db, notificationConfig, baseOpts);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toContain("当前无持仓");
  });

  it("无平仓记录时显示'暂无已平仓记录'", async () => {
    const db = makeDb();
    await sendHeartbeat(db, notificationConfig, baseOpts);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toContain("暂无已平仓记录");
  });

  it("消息使用 Markdown 格式", async () => {
    const db = makeDb();
    await sendHeartbeat(db, notificationConfig, baseOpts);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.parse_mode).toBe("Markdown");
  });

  it("消息包含心跳 emoji 和标题", async () => {
    const db = makeDb();
    await sendHeartbeat(db, notificationConfig, baseOpts);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toContain("💓");
    expect(body.text).toContain("Stratum 心跳");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("sendHeartbeat — 运行时长格式化", () => {
  it("不足 1 小时时只显示分钟", async () => {
    const db = makeDb();
    const opts = { ...baseOpts, startedAt: Date.now() - 30 * 60 * 1000 }; // 30分钟前
    await sendHeartbeat(db, notificationConfig, opts);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toMatch(/运行时长：30m/);
  });

  it("超过 1 小时时显示 Xh Ym 格式", async () => {
    const db = makeDb();
    const opts = { ...baseOpts, startedAt: Date.now() - 90 * 60 * 1000 }; // 1.5小时前
    await sendHeartbeat(db, notificationConfig, opts);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toMatch(/运行时长：1h 30m/);
  });
});

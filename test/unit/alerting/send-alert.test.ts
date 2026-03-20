import { describe, it, expect, vi } from "vitest";
import { sendAlert } from "../../../src/services/alerting/send-alert.js";
import type { AlertPayload } from "../../../src/domain/signal/alert-payload.js";
import type { TradeCandidate } from "../../../src/domain/signal/trade-candidate.js";
import type { MarketContext } from "../../../src/domain/market/market-context.js";
import type { TelegramConfig } from "../../../src/services/alerting/send-alert.js";

// ── テスト夹具 ────────────────────────────────────────────────────────────────

function makePayload(): AlertPayload {
  const candidate: TradeCandidate = {
    symbol: "BTCUSDT",
    direction: "long",
    timeframe: "4h",
    entryLow: 59800,
    entryHigh: 60000,
    stopLoss: 58800,
    takeProfit: 63000,
    riskReward: 2.5,
    signalGrade: "high-conviction",
    regimeAligned: true,
    participantAligned: true,
    structureReason: "FVG",
    contextReason: "Trend",
    reasonCodes: [],
  };
  const marketContext: MarketContext = {
    regime: "trend",
    regimeConfidence: 75,
    regimeReasons: [],
    participantBias: "balanced",
    participantPressureType: "none",
    participantConfidence: 70,
    participantRationale: "",
    spotPerpBasis: 0,
    basisDivergence: false,
    liquiditySession: "london_ramp",
    summary: "Trend market",
    reasonCodes: [],
  };
  return { candidate, marketContext, alertStatus: "pending", createdAt: Date.now() };
}

const validConfig: TelegramConfig = {
  botToken: "test-bot-token",
  chatId: "-100123456",
};

function mockFetch(ok: boolean, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({ ok, status }) as unknown as typeof fetch;
}

// ── 成功パス ──────────────────────────────────────────────────────────────────

describe("sendAlert — 成功", () => {
  it("HTTP 200 OK → true を返す", async () => {
    const result = await sendAlert(makePayload(), validConfig, mockFetch(true));
    expect(result).toBe(true);
  });

  it("正しい Telegram API エンドポイントに POST する", async () => {
    const fetchMock = mockFetch(true);
    await sendAlert(makePayload(), validConfig, fetchMock);
    const [url] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("api.telegram.org");
    expect(url).toContain("test-bot-token");
    expect(url).toContain("sendMessage");
  });

  it("POST リクエストを使う", async () => {
    const fetchMock = mockFetch(true);
    await sendAlert(makePayload(), validConfig, fetchMock);
    const [, options] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((options as RequestInit).method).toBe("POST");
  });

  it("Content-Type: application/json ヘッダーを付ける", async () => {
    const fetchMock = mockFetch(true);
    await sendAlert(makePayload(), validConfig, fetchMock);
    const [, options] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((options as RequestInit).headers).toMatchObject({
      "Content-Type": "application/json",
    });
  });

  it("body に chat_id が含まれる", async () => {
    const fetchMock = mockFetch(true);
    await sendAlert(makePayload(), validConfig, fetchMock);
    const [, options] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.chat_id).toBe("-100123456");
  });

  it("body に text（フォーマット済みメッセージ）が含まれる", async () => {
    const fetchMock = mockFetch(true);
    await sendAlert(makePayload(), validConfig, fetchMock);
    const [, options] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(typeof body.text).toBe("string");
    expect(body.text).toContain("BTCUSDT");
  });
});

// ── 失敗パス ──────────────────────────────────────────────────────────────────

describe("sendAlert — 失敗", () => {
  it("HTTP 429 Too Many Requests → false", async () => {
    const result = await sendAlert(makePayload(), validConfig, mockFetch(false, 429));
    expect(result).toBe(false);
  });

  it("HTTP 401 Unauthorized → false", async () => {
    const result = await sendAlert(makePayload(), validConfig, mockFetch(false, 401));
    expect(result).toBe(false);
  });

  it("fetch が throw → false（クラッシュしない）", async () => {
    const throwingFetch = vi.fn().mockRejectedValue(new Error("Network error")) as unknown as typeof fetch;
    const result = await sendAlert(makePayload(), validConfig, throwingFetch);
    expect(result).toBe(false);
  });
});

// ── 設定バリデーション ─────────────────────────────────────────────────────────

describe("sendAlert — 空の設定", () => {
  it("botToken が空文字 → fetch を呼ばず false", async () => {
    const fetchMock = mockFetch(true);
    const result = await sendAlert(makePayload(), { botToken: "", chatId: "-100" }, fetchMock);
    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("chatId が空文字 → fetch を呼ばず false", async () => {
    const fetchMock = mockFetch(true);
    const result = await sendAlert(makePayload(), { botToken: "token", chatId: "" }, fetchMock);
    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

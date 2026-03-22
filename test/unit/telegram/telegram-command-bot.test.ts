import { describe, it, expect, vi } from "vitest";
import {
  computeOffsetFromUpdates,
  getNextOffset,
  isCommandMessage,
  parsePriceArgs,
  startTelegramCommandBot,
} from "../../../src/services/telegram/telegram-command-bot.js";

describe("parsePriceArgs", () => {
  it("parses positional args", () => {
    expect(parsePriceArgs(["BTC", "spot"])).toEqual({ symbol: "BTC", market: "spot" });
    expect(parsePriceArgs(["ETHUSDT", "perp"])).toEqual({ symbol: "ETHUSDT", market: "perp" });
  });

  it("parses key-value args", () => {
    expect(parsePriceArgs(["symbol=BTCUSDT", "market=spot"])).toEqual({
      symbol: "BTCUSDT",
      market: "spot",
    });
  });

  it("supports mixed args", () => {
    expect(parsePriceArgs(["market=spot", "ETH"])).toEqual({ symbol: "ETH", market: "spot" });
  });

  it("returns nulls when no args", () => {
    expect(parsePriceArgs([])).toEqual({ symbol: null, market: null });
  });
});

describe("isCommandMessage", () => {
  it("returns true for slash commands", () => {
    expect(isCommandMessage("/status")).toBe(true);
    expect(isCommandMessage(" /price BTC")).toBe(true);
  });

  it("returns false for normal chat text", () => {
    expect(isCommandMessage("hello bot")).toBe(false);
    expect(isCommandMessage("price BTC")).toBe(false);
  });
});

describe("offset helpers", () => {
  it("getNextOffset always moves forward", () => {
    expect(getNextOffset(0, 10)).toBe(11);
    expect(getNextOffset(50, 10)).toBe(50);
  });

  it("computeOffsetFromUpdates picks latest update_id + 1", () => {
    const offset = computeOffsetFromUpdates(0, [
      { update_id: 100 },
      { update_id: 105 },
      { update_id: 103 },
    ]);
    expect(offset).toBe(106);
  });
});

describe("startTelegramCommandBot integration", () => {
  it("does not replay backlog and ignores non-command text", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      const isGetUpdates = String(_url).includes("/getUpdates");
      const isSendMessage = String(_url).includes("/sendMessage");

      if (isGetUpdates) {
        const timeout = Number(body.timeout ?? 0);
        const offset = Number(body.offset ?? 0);

        // bootstrap drain: contains old command, must NOT be executed
        if (timeout === 0) {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              result: [
                { update_id: 100, message: { chat: { id: "chat-1" }, text: "/status" } },
              ],
            }),
          } as Response;
        }

        // first polling batch: one non-command + one new command
        if (timeout === 20 && offset === 101) {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              result: [
                { update_id: 101, message: { chat: { id: "chat-1" }, text: "hello everyone" } },
                { update_id: 102, message: { chat: { id: "chat-1" }, text: "/status" } },
              ],
            }),
          } as Response;
        }

        // stop loop deterministically
        const abortErr = new Error("aborted");
        abortErr.name = "AbortError";
        throw abortErr;
      }

      if (isSendMessage) {
        return {
          ok: true,
          text: async () => "",
        } as Response;
      }

      throw new Error(`unexpected url: ${_url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const handle = startTelegramCommandBot({
      token: "token",
      allowedChatId: "chat-1",
      version: "0.13.0",
      startedAt: Date.now() - 60_000,
      symbol: "BTC/USDT:USDT",
      spotSymbol: "BTC/USDT",
      getLastScanAt: () => null,
      getCurrentSession: () => "london_ny_overlap",
      getOpenPositions: () => [],
      fetchPerpPrice: async () => 60000,
      fetchSpotPrice: async () => 59900,
    });

    // allow loop to process bootstrap + one polling cycle
    await new Promise((resolve) => setTimeout(resolve, 50));
    handle.stop();

    const sendCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/sendMessage")
    );
    const updateCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/getUpdates")
    );

    // bootstrap + at least one polling call
    expect(updateCalls.length).toBeGreaterThanOrEqual(2);
    // only /status from new polling batch should be replied
    expect(sendCalls).toHaveLength(1);

    const sentBody = JSON.parse(String(sendCalls[0][1]?.body ?? "{}")) as Record<string, unknown>;
    const sentText = String(sentBody.text ?? "");
    expect(sentText).toContain("Stratum Status");
  });
});

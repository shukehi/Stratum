import { describe, it, expect, vi } from "vitest";
import { sendAlert } from "../../../src/services/alerting/send-alert.js";
import type { AlertPayload } from "../../../src/domain/signal/alert-payload.js";

describe("sendAlert (V3 FSD Silent Mode)", () => {
  const makePayload = (reasonCodes: string[] = []): AlertPayload => ({
    candidate: {
      symbol: "BTCUSDT",
      direction: "long",
      timeframe: "4h",
      entryLow: 60000,
      entryHigh: 61000,
      stopLoss: 59000,
      takeProfit: 65000,
      riskReward: 4.0,
      capitalVelocityScore: 85,
      regimeAligned: true,
      participantAligned: true,
      structureReason: "Test",
      contextReason: "Test",
      reasonCodes: reasonCodes as any[],
    },
    marketContext: {} as any,
    alertStatus: "sent",
    createdAt: Date.now(),
  });

  it("静默法则：常规交易信号不触发网络请求并返回 true", async () => {
    const mockFetch = vi.fn();
    const payload = makePayload(["LIQUIDITY_SWEEP_CONFIRMED"]);
    
    const result = await sendAlert(payload, {}, mockFetch as any);
    
    expect(result).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("灾难推送：包含 ERROR 码时触发真实网络通知", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    const payload = makePayload(["API_ERROR", "CRITICAL_SLIPPAGE"]);
    
    const result = await sendAlert(payload, { telegram: { botToken: "t", chatId: "c" } }, mockFetch as any);
    
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalled();
  });
});

import { describe, it, expect } from "vitest";
import { formatAlert } from "../../../src/services/alerting/format-alert.js";
import type { AlertPayload } from "../../../src/domain/signal/alert-payload.js";

function makePayload(overrides: any = {}): AlertPayload {
  return {
    candidate: {
      symbol: "BTCUSDT",
      direction: "long",
      timeframe: "4h",
      entryLow: 60000,
      entryHigh: 61000,
      stopLoss: 59000,
      takeProfit: 65000,
      riskReward: 4.0,
      capitalVelocityScore: 85.5,
      regimeAligned: true,
      participantAligned: true,
      structureReason: "物理确认扫荡",
      contextReason: "趋势市场",
      reasonCodes: [],
      ...overrides.candidate,
    },
    marketContext: {
      regime: "trend",
      participantBias: "bullish",
      participantPressureType: "balanced",
      ...overrides.marketContext,
    },
    alertStatus: "sent",
    createdAt: Date.now(),
  };
}

describe("formatAlert (V2 Physics)", () => {
  it("消息头包含 CVS 分值和正确方向", () => {
    const p = makePayload();
    const text = formatAlert(p);
    expect(text).toContain("CVS: 85.5");
    expect(text).toContain("BTCUSDT 做多");
    expect(text).toContain("🚀");
  });

  it("空头信号使用正确 emoji", () => {
    const p = makePayload({ candidate: { direction: "short" } });
    const text = formatAlert(p);
    expect(text).toContain("📉");
    expect(text).toContain("做空");
  });

  it("包含物理感应和环境描述", () => {
    const p = makePayload();
    const text = formatAlert(p);
    expect(text).toContain("环境        趋势市 | 情绪偏多");
    expect(text).toContain("结构        物理确认扫荡");
  });
});

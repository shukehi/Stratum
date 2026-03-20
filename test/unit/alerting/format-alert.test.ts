import { describe, it, expect } from "vitest";
import { formatAlert } from "../../../src/services/alerting/format-alert.js";
import type { TradeCandidate } from "../../../src/domain/signal/trade-candidate.js";
import type { MarketContext } from "../../../src/domain/market/market-context.js";

// ── テスト夹具 ────────────────────────────────────────────────────────────────

function makeCandidate(overrides: Partial<TradeCandidate> = {}): TradeCandidate {
  return {
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
    structureReason: "FVG + 流动性扫描",
    contextReason: "趋势市场",
    reasonCodes: [],
    ...overrides,
  };
}

function makeCtx(overrides: Partial<MarketContext> = {}): MarketContext {
  return {
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
    summary: "テスト",
    reasonCodes: [],
    ...overrides,
  };
}

// ── 方向・等級 ────────────────────────────────────────────────────────────────

describe("formatAlert — 方向と等級", () => {
  it("long → 🟢 と LONG が含まれる", () => {
    const msg = formatAlert(makeCandidate({ direction: "long" }), makeCtx());
    expect(msg).toContain("🟢");
    expect(msg).toContain("LONG");
  });

  it("short → 🔴 と SHORT が含まれる", () => {
    const msg = formatAlert(makeCandidate({ direction: "short" }), makeCtx());
    expect(msg).toContain("🔴");
    expect(msg).toContain("SHORT");
  });

  it("high-conviction → 🔥 が含まれる", () => {
    const msg = formatAlert(makeCandidate({ signalGrade: "high-conviction" }), makeCtx());
    expect(msg).toContain("🔥");
    expect(msg).toContain("HIGH CONVICTION");
  });

  it("standard → 📊 が含まれる", () => {
    const msg = formatAlert(makeCandidate({ signalGrade: "standard" }), makeCtx());
    expect(msg).toContain("📊");
    expect(msg).toContain("STANDARD");
  });

  it("watch → 👀 が含まれる", () => {
    const msg = formatAlert(makeCandidate({ signalGrade: "watch" }), makeCtx());
    expect(msg).toContain("👀");
    expect(msg).toContain("WATCH");
  });
});

// ── 価格情報 ──────────────────────────────────────────────────────────────────

describe("formatAlert — 価格情報", () => {
  it("symbol が含まれる", () => {
    const msg = formatAlert(makeCandidate({ symbol: "ETHUSDT" }), makeCtx());
    expect(msg).toContain("ETHUSDT");
  });

  it("entryLow が含まれる", () => {
    const msg = formatAlert(makeCandidate(), makeCtx());
    expect(msg).toContain("59,800");
  });

  it("entryHigh が含まれる", () => {
    const msg = formatAlert(makeCandidate(), makeCtx());
    expect(msg).toContain("60,000");
  });

  it("stopLoss が含まれる", () => {
    const msg = formatAlert(makeCandidate(), makeCtx());
    expect(msg).toContain("58,800");
  });

  it("takeProfit が含まれる", () => {
    const msg = formatAlert(makeCandidate(), makeCtx());
    expect(msg).toContain("63,000");
  });

  it("RR が 1 桁小数点で含まれる", () => {
    const msg = formatAlert(makeCandidate({ riskReward: 2.5 }), makeCtx());
    expect(msg).toContain("2.5");
  });
});

// ── アラインメントフラグ ──────────────────────────────────────────────────────

describe("formatAlert — alignment フラグ", () => {
  it("regimeAligned=true → ✓ が含まれる", () => {
    const msg = formatAlert(makeCandidate({ regimeAligned: true }), makeCtx());
    expect(msg).toContain("✓");
  });

  it("regimeAligned=false → ✗ が含まれる", () => {
    const msg = formatAlert(makeCandidate({ regimeAligned: false }), makeCtx());
    expect(msg).toContain("✗");
  });

  it("regime が含まれる", () => {
    const msg = formatAlert(makeCandidate(), makeCtx({ regime: "range" }));
    expect(msg).toContain("range");
  });
});

// ── 構造 / コンテキスト ───────────────────────────────────────────────────────

describe("formatAlert — structureReason / contextReason", () => {
  it("structureReason が含まれる", () => {
    const msg = formatAlert(makeCandidate({ structureReason: "FVG confluence" }), makeCtx());
    expect(msg).toContain("FVG confluence");
  });

  it("contextReason が含まれる", () => {
    const msg = formatAlert(makeCandidate({ contextReason: "London breakout" }), makeCtx());
    expect(msg).toContain("London breakout");
  });
});

// ── macroReason ───────────────────────────────────────────────────────────────

describe("formatAlert — macroReason", () => {
  it("macroReason が指定された場合は Macro 行が含まれる", () => {
    const msg = formatAlert(makeCandidate({ macroReason: "Fed pivot supports BTC." }), makeCtx());
    expect(msg).toContain("Macro");
    expect(msg).toContain("Fed pivot supports BTC.");
  });

  it("macroReason=undefined → Macro 行が省略される", () => {
    const msg = formatAlert(makeCandidate({ macroReason: undefined }), makeCtx());
    expect(msg).not.toContain("Macro");
  });
});

// ── 出力フォーマット ──────────────────────────────────────────────────────────

describe("formatAlert — 出力フォーマット", () => {
  it("複数行（\\n 含む）", () => {
    const msg = formatAlert(makeCandidate(), makeCtx());
    expect(msg.split("\n").length).toBeGreaterThan(5);
  });

  it("文字数が 4096 以内（Telegram 上限）", () => {
    const msg = formatAlert(makeCandidate({ macroReason: "x".repeat(100) }), makeCtx());
    expect(msg.length).toBeLessThanOrEqual(4096);
  });
});

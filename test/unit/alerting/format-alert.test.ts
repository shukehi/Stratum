import { describe, it, expect } from "vitest";
import { formatAlert } from "../../../src/services/alerting/format-alert.js";
import type { TradeCandidate } from "../../../src/domain/signal/trade-candidate.js";
import type { MarketContext } from "../../../src/domain/market/market-context.js";
import type { PositionSizingSummary } from "../../../src/domain/signal/position-sizing.js";

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

function makePositionSizing(
  overrides: Partial<PositionSizingSummary> = {}
): PositionSizingSummary {
  return {
    status: "available",
    recommendedPositionSize: 50_000,
    recommendedBaseSize: 0.834,
    riskAmount: 1_000,
    accountRiskPercent: 0.01,
    sameDirectionExposureCount: 1,
    sameDirectionExposureRiskPercent: 0.01,
    projectedSameDirectionRiskPercent: 0.02,
    portfolioOpenRiskPercent: 0.02,
    projectedPortfolioRiskPercent: 0.03,
    ...overrides,
  };
}

// ── 方向・等級 ────────────────────────────────────────────────────────────────

describe("formatAlert — 方向と等級", () => {
  it("long → 🟢 与中文多头标签", () => {
    const msg = formatAlert(makeCandidate({ direction: "long" }), makeCtx());
    expect(msg).toContain("🟢");
    expect(msg).toContain("多头");
  });

  it("short → 🔴 与中文空头标签", () => {
    const msg = formatAlert(makeCandidate({ direction: "short" }), makeCtx());
    expect(msg).toContain("🔴");
    expect(msg).toContain("空头");
  });

  it("high-conviction → 🔥 与中文高信念标签", () => {
    const msg = formatAlert(makeCandidate({ signalGrade: "high-conviction" }), makeCtx());
    expect(msg).toContain("🔥");
    expect(msg).toContain("高信念");
  });

  it("standard → 📊 与中文标准标签", () => {
    const msg = formatAlert(makeCandidate({ signalGrade: "standard" }), makeCtx());
    expect(msg).toContain("📊");
    expect(msg).toContain("标准");
  });

  it("watch → 👀 与中文观察标签", () => {
    const msg = formatAlert(makeCandidate({ signalGrade: "watch" }), makeCtx());
    expect(msg).toContain("👀");
    expect(msg).toContain("观察");
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

  it("regime 会显示为中文标签", () => {
    const msg = formatAlert(makeCandidate(), makeCtx({ regime: "range" }));
    expect(msg).toContain("市场状态");
    expect(msg).toContain("震荡");
  });

  it("participant pressure type 与 session 会显示为中文", () => {
    const msg = formatAlert(
      makeCandidate(),
      makeCtx({ participantPressureType: "squeeze-risk", liquiditySession: "london_ny_overlap" })
    );
    expect(msg).toContain("压力类型");
    expect(msg).toContain("逼空风险");
    expect(msg).toContain("交易时段");
    expect(msg).toContain("伦敦纽约重叠");
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

  it("英文 context summary 会被压缩成更易读的中文摘要", () => {
    const msg = formatAlert(
      makeCandidate({
        contextReason:
          "Regime: range (80%) | Driver: short-covering (58%) | Participants: short-crowded / squeeze-risk (55%) | Session: london_ny_overlap",
      }),
      makeCtx()
    );
    expect(msg).toContain("状态：震荡");
    expect(msg).toContain("驱动：空头回补");
    expect(msg).toContain("参与者：空头拥挤 / 逼空风险");
    expect(msg).toContain("时段：伦敦纽约重叠");
  });

  it("confirmation / daily bias / order flow 会从 reasonCodes 推断并展示", () => {
    const msg = formatAlert(
      makeCandidate({
        reasonCodes: [
          "STRUCTURE_CONFIRMATION_PENDING",
          "DAILY_TREND_COUNTER",
          "ORDER_FLOW_ALIGNED",
        ],
      }),
      makeCtx()
    );
    expect(msg).toContain("确认状态");
    expect(msg).toContain("待确认");
    expect(msg).toContain("日线偏向");
    expect(msg).toContain("看空");
    expect(msg).toContain("订单流");
    expect(msg).toContain("看多");
  });
});

// ── macroReason ───────────────────────────────────────────────────────────────

describe("formatAlert — macroReason", () => {
  it("macroReason 指定时会显示中文宏观行", () => {
    const msg = formatAlert(makeCandidate({ macroReason: "Fed pivot supports BTC." }), makeCtx());
    expect(msg).toContain("宏观");
    expect(msg).toContain("Fed pivot supports BTC.");
  });

  it("macroReason=undefined → Macro 行が省略される", () => {
    const msg = formatAlert(makeCandidate({ macroReason: undefined }), makeCtx());
    expect(msg).not.toContain("Macro");
  });
});

describe("formatAlert — position sizing", () => {
  it("可计算时会展示中文风险、仓位和组合暴露", () => {
    const msg = formatAlert(makeCandidate(), makeCtx(), makePositionSizing());
    expect(msg).toContain("单笔风险");
    expect(msg).toContain("$1,000");
    expect(msg).toContain("建议仓位");
    expect(msg).toContain("$50,000");
    expect(msg).toContain("同向暴露");
    expect(msg).toContain("1.0 % -> 2.0 %");
    expect(msg).toContain("组合风险");
  });

  it("不可计算时会明确说明中文不可计算原因", () => {
    const msg = formatAlert(
      makeCandidate(),
      makeCtx(),
      makePositionSizing({
        status: "unavailable",
        reason: "account_size_missing",
        recommendedPositionSize: undefined,
        recommendedBaseSize: undefined,
        riskAmount: undefined,
      })
    );
    expect(msg).toContain("无法计算（缺少账户规模）");
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

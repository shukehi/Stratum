import { describe, it, expect } from "vitest";
import { applyMacroOverlay } from "../../../src/services/macro/apply-macro-overlay.js";
import type { TradeCandidate } from "../../../src/domain/signal/trade-candidate.js";
import type { MacroOverlayDecision } from "../../../src/domain/macro/macro-assessment.js";

// ── 测试夹具 ──────────────────────────────────────────────────────────────────

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
    regimeAligned: true,
    participantAligned: true,
    structureReason: "FVG + 流动性扫描",
    contextReason: "趋势市场",
    signalGrade: "high-conviction",
    reasonCodes: [],
    ...overrides,
  };
}

function makeDecision(overrides: Partial<MacroOverlayDecision> = {}): MacroOverlayDecision {
  return {
    action: "pass",
    confidence: 8,
    reason: "Fed bullish pivot expected",
    reasonCodes: [],
    ...overrides,
  };
}

// ── action=pass ───────────────────────────────────────────────────────────────

describe("applyMacroOverlay — action=pass", () => {
  it("候选等级不变", () => {
    const result = applyMacroOverlay([makeCandidate({ signalGrade: "high-conviction" })], makeDecision());
    expect(result[0].signalGrade).toBe("high-conviction");
  });

  it("macroReason 写入 decision.reason", () => {
    const result = applyMacroOverlay([makeCandidate()], makeDecision({ reason: "Bullish BTC catalysts" }));
    expect(result[0].macroReason).toBe("Bullish BTC catalysts");
  });

  it("decision.reasonCodes 合并进候选", () => {
    const result = applyMacroOverlay(
      [makeCandidate({ reasonCodes: ["STRUCTURE_CONFLUENCE_BOOST"] })],
      makeDecision({ reasonCodes: ["EVENT_WINDOW_WATCH_ONLY"] })
    );
    expect(result[0].reasonCodes).toContain("STRUCTURE_CONFLUENCE_BOOST");
    expect(result[0].reasonCodes).toContain("EVENT_WINDOW_WATCH_ONLY");
  });

  it("候选数量不变（2 个 → 仍返回 2 个）", () => {
    const result = applyMacroOverlay([makeCandidate(), makeCandidate()], makeDecision());
    expect(result).toHaveLength(2);
  });

  it("结构字段（entry / stop / TP / RR）不被修改", () => {
    const candidate = makeCandidate({ entryHigh: 60000, stopLoss: 58800, takeProfit: 63000, riskReward: 2.5 });
    const result = applyMacroOverlay([candidate], makeDecision());
    expect(result[0].entryHigh).toBe(60000);
    expect(result[0].stopLoss).toBe(58800);
    expect(result[0].takeProfit).toBe(63000);
    expect(result[0].riskReward).toBe(2.5);
  });
});

// ── action=downgrade ──────────────────────────────────────────────────────────

describe("applyMacroOverlay — action=downgrade", () => {
  const downgradeDecision = makeDecision({ action: "downgrade", reasonCodes: ["MACRO_DOWNGRADED"] });

  it("high-conviction → standard", () => {
    const result = applyMacroOverlay([makeCandidate({ signalGrade: "high-conviction" })], downgradeDecision);
    expect(result[0].signalGrade).toBe("standard");
  });

  it("standard → watch", () => {
    const result = applyMacroOverlay([makeCandidate({ signalGrade: "standard" })], downgradeDecision);
    expect(result[0].signalGrade).toBe("watch");
  });

  it("watch → watch（底层不再降级）", () => {
    const result = applyMacroOverlay([makeCandidate({ signalGrade: "watch" })], downgradeDecision);
    expect(result[0].signalGrade).toBe("watch");
  });

  it("macroReason 写入", () => {
    const decision = makeDecision({ action: "downgrade", reason: "Bearish macro: hawkish Fed", reasonCodes: ["MACRO_DOWNGRADED"] });
    const result = applyMacroOverlay([makeCandidate()], decision);
    expect(result[0].macroReason).toBe("Bearish macro: hawkish Fed");
  });

  it("MACRO_DOWNGRADED 出现在 reasonCodes 中", () => {
    const result = applyMacroOverlay([makeCandidate()], downgradeDecision);
    expect(result[0].reasonCodes).toContain("MACRO_DOWNGRADED");
  });

  it("多候选各自降级", () => {
    const candidates = [
      makeCandidate({ signalGrade: "high-conviction" }),
      makeCandidate({ signalGrade: "standard" }),
    ];
    const result = applyMacroOverlay(candidates, downgradeDecision);
    expect(result[0].signalGrade).toBe("standard");
    expect(result[1].signalGrade).toBe("watch");
  });
});

// ── action=block ──────────────────────────────────────────────────────────────

describe("applyMacroOverlay — action=block", () => {
  const blockDecision = makeDecision({ action: "block", reasonCodes: ["MACRO_BLOCKED"] });

  it("单候选 → 返回空数组", () => {
    const result = applyMacroOverlay([makeCandidate()], blockDecision);
    expect(result).toHaveLength(0);
  });

  it("多候选 → 全部被移除", () => {
    const result = applyMacroOverlay([makeCandidate(), makeCandidate(), makeCandidate()], blockDecision);
    expect(result).toHaveLength(0);
  });

  it("空候选数组 → 仍返回空数组", () => {
    const result = applyMacroOverlay([], blockDecision);
    expect(result).toHaveLength(0);
  });
});

// ── 边界：空候选列表 ──────────────────────────────────────────────────────────

describe("applyMacroOverlay — 空候选列表", () => {
  it("pass + 空数组 → 空数组", () => {
    expect(applyMacroOverlay([], makeDecision({ action: "pass" }))).toHaveLength(0);
  });

  it("downgrade + 空数组 → 空数组", () => {
    expect(applyMacroOverlay([], makeDecision({ action: "downgrade" }))).toHaveLength(0);
  });
});

// ── reasonCodes 去重 ──────────────────────────────────────────────────────────

describe("applyMacroOverlay — reasonCodes 去重", () => {
  it("setup 和 decision 中同时有 EVENT_WINDOW_WATCH_ONLY → 不重复", () => {
    const result = applyMacroOverlay(
      [makeCandidate({ reasonCodes: ["EVENT_WINDOW_WATCH_ONLY"] })],
      makeDecision({ action: "pass", reasonCodes: ["EVENT_WINDOW_WATCH_ONLY"] })
    );
    const count = result[0].reasonCodes.filter((c) => c === "EVENT_WINDOW_WATCH_ONLY").length;
    expect(count).toBe(1);
  });
});

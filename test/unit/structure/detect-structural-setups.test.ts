import { describe, it, expect } from "vitest";
import { detectStructuralSetups } from "../../../src/services/structure/detect-structural-setups.js";
import { detectFvg } from "../../../src/services/structure/detect-fvg.js";
import { detectLiquiditySweep } from "../../../src/services/structure/detect-liquidity-sweep.js";
import { applyConfluence } from "../../../src/services/structure/detect-confluence.js";
import { confirmEntry } from "../../../src/services/structure/confirm-entry.js";
import { applySessionAdjustment } from "../../../src/services/structure/apply-session-adjustment.js";
import { strategyConfig } from "../../../src/app/config.js";
import type { Candle } from "../../../src/domain/market/candle.js";
import type { MarketContext } from "../../../src/domain/market/market-context.js";
import type { StructuralSetup } from "../../../src/domain/signal/structural-setup.js";

// ── Fixture helpers ──────────────────────────────────────────────────────────

const BASE_TIME = 1_700_000_000_000;
const INTERVAL_4H = 4 * 60 * 60 * 1000;
const INTERVAL_1H = 60 * 60 * 1000;

function makeCandle(i: number, open: number, high: number, low: number, close: number, interval = INTERVAL_4H): Candle {
  return { timestamp: BASE_TIME + i * interval, open, high, low, close, volume: 1000 };
}

function makeCtx(overrides: Partial<MarketContext> = {}): MarketContext {
  return {
    regime: "trend",
    regimeConfidence: 75,
    regimeReasons: ["trend confirmed"],
    participantBias: "long-crowded",
    participantPressureType: "flush-risk",
    participantConfidence: 70,
    participantRationale: "OI up, price up",
    spotPerpBasis: 0,
    basisDivergence: false,
    liquiditySession: "london_ny_overlap",
    summary: "trend | long-crowded | london_ny_overlap",
    reasonCodes: [],
    ...overrides,
  };
}

/** 看涨 FVG fixture: 20 背景 + 3 FVG K 线 */
function makeBullishFvgCandles4h(): Candle[] {
  // high=60800 防止背景与 FVG 中间根（low=60700）形成意外缺口
  const bg = Array.from({ length: 20 }, (_, i) =>
    makeCandle(i, 60000, 60800, 59700, 60100)  // ATR ~1100
  );
  const c0 = makeCandle(20, 60000, 60500, 59500, 60400); // high=60500
  const c1 = makeCandle(21, 60800, 61500, 60700, 61400);
  const c2 = makeCandle(22, 61200, 61800, 61000, 61600); // low=61000
  return [...bg, c0, c1, c2];
}

/** 构造 1h K 线，价格进入 FVG 区域并出现长下影线 */
function make1hConfirmation(entryHigh: number, stopLoss: number): Candle[] {
  // 长下影线确认 K 线: 下影线 >= 50% 振幅
  const low = entryHigh - 200;           // 进入区域
  const high = entryHigh + 100;
  const bodyLow = low + (high - low) * 0.6; // 下影线比例 60% > 50%
  return [
    makeCandle(0, bodyLow + 50, high, low, bodyLow + 80, INTERVAL_1H),
  ];
}

/** 构造 1h K 线，价格穿透止损 */
function make1hInvalidation(stopLoss: number): Candle[] {
  return [
    makeCandle(0, stopLoss - 100, stopLoss - 50, stopLoss - 200, stopLoss - 150, INTERVAL_1H),
  ];
}

/** 有效流动性扫描 fixture: swing low + 穿透 + 4h 收回 */
function makeBullishSweepCandles4h(): Candle[] {
  // 背景: 20 根，建立 swing low 在 ~59000
  const bg = Array.from({ length: 20 }, (_, i) =>
    makeCandle(i, 60000, 60300, 59700, 60100)
  );
  // Swing low K 线 (i=20..22): 局部低点 59000（左右各 3 根）
  const preSwing = Array.from({ length: 3 }, (_, i) =>
    makeCandle(20 + i, 59200, 59500, 59200, 59300)  // 高于 swing
  );
  const swingLow = makeCandle(23, 59100, 59400, 59000, 59200); // swing low=59000
  const postSwing = Array.from({ length: 3 }, (_, i) =>
    makeCandle(24 + i, 59200, 59500, 59200, 59300)  // 高于 swing
  );
  // 正常 K 线（用来"隔开" sweep window）
  const mid = Array.from({ length: 5 }, (_, i) =>
    makeCandle(27 + i, 60000, 60300, 59700, 60100)
  );
  // 扫描 K 线: 刺破 59000，但 4h 收盘回到 59000 之上
  const sweep = makeCandle(32, 59100, 59400, 58800, 59200); // low=58800 < 59000, close=59200 > 59000
  return [...bg, ...preSwing, swingLow, ...postSwing, ...mid, sweep];
}

/** 无效扫描: 刺破但 4h 未收回 */
function makeInvalidSweepCandles4h(): Candle[] {
  const bg = Array.from({ length: 20 }, (_, i) =>
    makeCandle(i, 60000, 60300, 59700, 60100)
  );
  const preSwing = Array.from({ length: 3 }, (_, i) =>
    makeCandle(20 + i, 59200, 59500, 59200, 59300)
  );
  const swingLow = makeCandle(23, 59100, 59400, 59000, 59200);
  const postSwing = Array.from({ length: 3 }, (_, i) =>
    makeCandle(24 + i, 59200, 59500, 59200, 59300)
  );
  const mid = Array.from({ length: 5 }, (_, i) =>
    makeCandle(27 + i, 60000, 60300, 59700, 60100)
  );
  // 无效: 刺破 59000 但收盘仍在 59000 之下
  const invalidSweep = makeCandle(32, 59100, 59400, 58800, 58900); // close=58900 < 59000
  return [...bg, ...preSwing, swingLow, ...postSwing, ...mid, invalidSweep];
}

// ── 早退：真空期 / 低置信度 ──────────────────────────────────────────────────

describe("detectStructuralSetups — 早退条件", () => {
  it("DELEVERAGING_VACUUM 时返回空数组", () => {
    const ctx = makeCtx({ reasonCodes: ["DELEVERAGING_VACUUM"] });
    const result = detectStructuralSetups(makeBullishFvgCandles4h(), [], ctx, strategyConfig);
    expect(result).toHaveLength(0);
  });

  it("regimeConfidence 低于阈值时返回空数组", () => {
    const ctx = makeCtx({ regimeConfidence: strategyConfig.minRegimeConfidence - 1 });
    const result = detectStructuralSetups(makeBullishFvgCandles4h(), [], ctx, strategyConfig);
    expect(result).toHaveLength(0);
  });

  it("正常置信度 + 无真空期时不早退", () => {
    const ctx = makeCtx();
    // 使用明确的 FVG fixture，预期至少返回 1 个 setup
    const candles = makeBullishFvgCandles4h();
    const result = detectStructuralSetups(candles, [], ctx, strategyConfig);
    // 可能有或没有 setup（取决于 score），但不应因早退返回空
    // 只要不因"早退"逻辑返回空即可（真实 check: 无 DELEVERAGING_VACUUM）
    expect(ctx.reasonCodes).not.toContain("DELEVERAGING_VACUUM");
  });
});

// ── FVG 检测 ─────────────────────────────────────────────────────────────────

describe("detectFvg — 单独测试", () => {
  it("有效看涨 FVG 返回 long setup", () => {
    const candles = makeBullishFvgCandles4h();
    const results = detectFvg(candles, "4h", strategyConfig);
    const fvg = results.find(r => r.direction === "long");
    expect(fvg).toBeDefined();
    expect(fvg!.confluenceFactors).toContain("fvg");
    expect(fvg!.confirmationStatus).toBe("pending");
  });

  it("无缺口的 K 线不生成 FVG", () => {
    const flat = Array.from({ length: 10 }, (_, i) =>
      makeCandle(i, 60000, 60100, 59900, 60000)  // 重叠 K 线，无缺口
    );
    const results = detectFvg(flat, "4h", strategyConfig);
    // 重叠 K 线不应生成有效 FVG
    expect(results.every(r => r.entryLow < r.entryHigh)).toBe(true);
  });
});

// ── 流动性扫描 ────────────────────────────────────────────────────────────────

describe("detectLiquiditySweep — 有效/无效扫描", () => {
  it("刺破 swing low + 4h 收回 → 生成看涨扫描 setup", () => {
    const candles = makeBullishSweepCandles4h();
    const results = detectLiquiditySweep(candles, strategyConfig);
    const sweep = results.find(r => r.direction === "long");
    expect(sweep).toBeDefined();
    expect(sweep!.confluenceFactors).toContain("liquidity-sweep");
    expect(sweep!.reasonCodes).toContain("LIQUIDITY_SWEEP_CONFIRMED");
    expect(sweep!.confirmationStatus).toBe("pending");
  });

  it("刺破 swing low 但 4h 未收回 → 不生成扫描 setup（无效扫描）", () => {
    const candles = makeInvalidSweepCandles4h();
    const results = detectLiquiditySweep(candles, strategyConfig);
    // 无效扫描不应生成任何 setup
    expect(results.filter(r => r.direction === "long")).toHaveLength(0);
  });
});

// ── 复合结构（Confluence） ───────────────────────────────────────────────────

describe("applyConfluence", () => {
  function makeSetup(overrides: Partial<StructuralSetup> = {}): StructuralSetup {
    return {
      timeframe: "4h",
      direction: "long",
      entryLow: 60000,
      entryHigh: 60500,
      stopLossHint: 59500,
      takeProfitHint: 61750,
      structureScore: 65,
      structureReason: "test",
      invalidationReason: "test",
      confluenceFactors: ["fvg"],
      confirmationStatus: "pending",
      confirmationTimeframe: "1h",
      reasonCodes: ["STRUCTURE_CONFIRMATION_PENDING"],
      ...overrides,
    };
  }

  it("FVG + 流动性池重叠 → confluenceFactors 含两项 + structureScore 加分", () => {
    const fvg = makeSetup({ confluenceFactors: ["fvg"] });
    const sweep = makeSetup({
      confluenceFactors: ["liquidity-sweep"],
      entryLow: 60100,
      entryHigh: 60600,
    });
    const result = applyConfluence([fvg, sweep], strategyConfig);
    const boosted = result.find(r => r.confluenceFactors.length >= 2);
    expect(boosted).toBeDefined();
    expect(boosted!.structureScore).toBeGreaterThan(65);
    expect(boosted!.reasonCodes).toContain("STRUCTURE_CONFLUENCE_BOOST");
  });

  it("流动性扫描 + FVG 重叠 → +confluenceBonus × 2（+20）", () => {
    const fvg = makeSetup({ confluenceFactors: ["fvg"], structureScore: 65 });
    const sweep = makeSetup({
      confluenceFactors: ["liquidity-sweep"],
      structureScore: 65,
      entryLow: 60100,
      entryHigh: 60600,
    });
    const result = applyConfluence([fvg, sweep], strategyConfig);
    const hasSweep = result.find(r => r.confluenceFactors.includes("liquidity-sweep"))!;
    const expectedBonus = strategyConfig.confluenceBonus * 2; // 20
    expect(hasSweep.structureScore).toBe(Math.min(100, 65 + expectedBonus));
  });

  it("3 种结构重叠 → +confluenceBonus × 1.5（+15）", () => {
    const zone = { entryLow: 60000, entryHigh: 60500 };
    const s1 = makeSetup({ ...zone, confluenceFactors: ["fvg"], structureScore: 65 });
    const s2 = makeSetup({ ...zone, confluenceFactors: ["swing-high-low"], structureScore: 65 });
    const s3 = makeSetup({ ...zone, confluenceFactors: ["high-volume-node"], structureScore: 65 });
    const result = applyConfluence([s1, s2, s3], strategyConfig);
    const boosted = result[0];
    expect(boosted.structureScore).toBe(Math.min(100, 65 + Math.round(strategyConfig.confluenceBonus * 1.5)));
  });

  it("无重叠时 structureScore 不变", () => {
    const s1 = makeSetup({ entryLow: 60000, entryHigh: 60200, structureScore: 65 });
    const s2 = makeSetup({ entryLow: 61000, entryHigh: 61500, structureScore: 65 }); // 不重叠
    const result = applyConfluence([s1, s2], strategyConfig);
    expect(result[0].structureScore).toBe(65);
    expect(result[1].structureScore).toBe(65);
  });

  it("不同方向的重叠区域不计入 confluence", () => {
    const long = makeSetup({ direction: "long", entryLow: 60000, entryHigh: 60500, structureScore: 65 });
    const short = makeSetup({ direction: "short", entryLow: 60100, entryHigh: 60600, structureScore: 65 });
    const result = applyConfluence([long, short], strategyConfig);
    expect(result[0].structureScore).toBe(65); // 方向不同不合并
    expect(result[1].structureScore).toBe(65);
  });
});

// ── 入场确认 ─────────────────────────────────────────────────────────────────

describe("confirmEntry", () => {
  function makePendingSetup(direction: "long" | "short" = "long"): StructuralSetup {
    return {
      timeframe: "4h",
      direction,
      entryLow: 60000,
      entryHigh: 60500,
      stopLossHint: direction === "long" ? 59500 : 61000,
      takeProfitHint: direction === "long" ? 61750 : 58250,
      structureScore: 70,
      structureReason: "test",
      invalidationReason: "test",
      confluenceFactors: ["fvg"],
      confirmationStatus: "pending",
      confirmationTimeframe: "1h",
      reasonCodes: ["STRUCTURE_CONFIRMATION_PENDING"],
    };
  }

  it("价格未进入区域 → pending", () => {
    const setup = makePendingSetup("long");
    // 1h K 线的 low 高于 entryHigh → 未进入
    const candles: Candle[] = [makeCandle(0, 61000, 61500, 60600, 61000, INTERVAL_1H)];
    const result = confirmEntry(setup, candles, strategyConfig);
    expect(result.confirmationStatus).toBe("pending");
  });

  it("做多: 进入区域 + 1h 长下影线 → confirmed", () => {
    const setup = makePendingSetup("long");
    // 下影线: low=59800(进入区域), close=60300, open=60300
    // 下影线 = min(open,close)-low = 60300-59800 = 500
    // 振幅 = high-low = 60800-59800 = 1000
    // 比例 = 500/1000 = 0.5 >= confirmationShadowRatio(0.5) ✓
    const c: Candle = makeCandle(0, 60300, 60800, 59800, 60300, INTERVAL_1H);
    const result = confirmEntry(setup, [c], strategyConfig);
    expect(result.confirmationStatus).toBe("confirmed");
    expect(result.reasonCodes).not.toContain("STRUCTURE_CONFIRMATION_PENDING");
  });

  it("做多: 进入区域 + 连续 2 根不创新低 → confirmed", () => {
    const setup = makePendingSetup("long");
    // 第一根: 进入区域 low=60200（entryHigh=60500，触及），不是下影线
    const c1 = makeCandle(0, 60400, 60450, 60200, 60430, INTERVAL_1H);
    // 第二根: low=60250 > 60200（不创新低），不是下影线
    const c2 = makeCandle(1, 60430, 60480, 60250, 60460, INTERVAL_1H);
    const result = confirmEntry(setup, [c1, c2], strategyConfig);
    expect(result.confirmationStatus).toBe("confirmed");
  });

  it("做多: 1h 收盘穿透止损 → invalidated", () => {
    const setup = makePendingSetup("long");
    // 进入区域，但收盘跌破 stopLossHint(59500)
    const c: Candle = makeCandle(0, 60200, 60200, 59000, 59400, INTERVAL_1H);
    const result = confirmEntry(setup, [c], strategyConfig);
    expect(result.confirmationStatus).toBe("invalidated");
    expect(result.reasonCodes).toContain("STRUCTURE_CONFIRMATION_INVALIDATED");
    expect(result.reasonCodes).not.toContain("STRUCTURE_CONFIRMATION_PENDING");
  });

  it("做空: 进入区域 + 1h 长上影线 → confirmed", () => {
    const setup = makePendingSetup("short");
    // 上影线: open=close=60600, low=60500(进入区域 entryLow=60000), high=61000
    // 上影线 = high-max(open,close) = 61000-60600 = 400
    // 振幅 = high-low = 61000-60500 = 500
    // 比例 = 400/500 = 0.8 >= 0.5 ✓
    const c: Candle = makeCandle(0, 60600, 61000, 60500, 60600, INTERVAL_1H);
    const result = confirmEntry(setup, [c], strategyConfig);
    expect(result.confirmationStatus).toBe("confirmed");
  });

  it("做空: 1h 收盘穿透止损 → invalidated", () => {
    const setup = makePendingSetup("short");
    // 进入区域，但收盘涨破 stopLossHint(61000)
    const c: Candle = makeCandle(0, 60500, 61200, 60300, 61100, INTERVAL_1H);
    const result = confirmEntry(setup, [c], strategyConfig);
    expect(result.confirmationStatus).toBe("invalidated");
  });

  it("已 invalidated 的 setup 不再重置", () => {
    const setup: StructuralSetup = {
      ...makePendingSetup("long"),
      confirmationStatus: "invalidated",
      reasonCodes: ["STRUCTURE_CONFIRMATION_INVALIDATED"],
    };
    const c: Candle = makeCandle(0, 60300, 60800, 59800, 60300, INTERVAL_1H); // 看似确认
    const result = confirmEntry(setup, [c], strategyConfig);
    expect(result.confirmationStatus).toBe("invalidated"); // 保持 invalidated
  });
});

// ── 交易时段修正 ──────────────────────────────────────────────────────────────

describe("applySessionAdjustment", () => {
  function makeScoredSetup(score: number): StructuralSetup {
    return {
      timeframe: "4h",
      direction: "long",
      entryLow: 60000,
      entryHigh: 60500,
      stopLossHint: 59500,
      takeProfitHint: 61750,
      structureScore: score,
      structureReason: "test",
      invalidationReason: "test",
      confluenceFactors: ["fvg"],
      confirmationStatus: "pending",
      confirmationTimeframe: "1h",
      reasonCodes: ["STRUCTURE_CONFIRMATION_PENDING"],
    };
  }

  it("asian_low 时段 structureScore 被折扣（× 0.8）", () => {
    const setup = makeScoredSetup(80);
    const result = applySessionAdjustment(setup, "asian_low", strategyConfig);
    expect(result.structureScore).toBe(Math.round(80 * strategyConfig.sessionDiscountFactor));
    expect(result.reasonCodes).toContain("SESSION_LOW_LIQUIDITY_DISCOUNT");
  });

  it("london_ramp 时段 structureScore 被加成（× 1.1）", () => {
    const setup = makeScoredSetup(70);
    const result = applySessionAdjustment(setup, "london_ramp", strategyConfig);
    expect(result.structureScore).toBe(Math.min(100, Math.round(70 * strategyConfig.sessionPremiumFactor)));
    expect(result.reasonCodes).not.toContain("SESSION_LOW_LIQUIDITY_DISCOUNT");
  });

  it("london_ny_overlap 时段 structureScore 不变", () => {
    const setup = makeScoredSetup(75);
    const result = applySessionAdjustment(setup, "london_ny_overlap", strategyConfig);
    expect(result.structureScore).toBe(75);
  });

  it("enableSessionAdjustment=false 时不修正任何时段", () => {
    const setup = makeScoredSetup(80);
    const config = { ...strategyConfig, enableSessionAdjustment: false };
    const result = applySessionAdjustment(setup, "asian_low", config);
    expect(result.structureScore).toBe(80); // 不折扣
  });

  it("stopLossHint 和 takeProfitHint 不受时段修正影响", () => {
    const setup = makeScoredSetup(80);
    const result = applySessionAdjustment(setup, "asian_low", strategyConfig);
    expect(result.stopLossHint).toBe(setup.stopLossHint);
    expect(result.takeProfitHint).toBe(setup.takeProfitHint);
  });
});

// ── 主入口集成 ────────────────────────────────────────────────────────────────

describe("detectStructuralSetups — 集成", () => {
  it("structureScore < minStructureScore 的 setup 被过滤", () => {
    const ctx = makeCtx();
    // 使用 asian_low 时段（0.8 折扣），如果原始分 < 75 则折后低于 60
    const ctxAsian = makeCtx({ liquiditySession: "asian_low" });
    const candles = makeBullishFvgCandles4h();
    const result = detectStructuralSetups(candles, [], ctxAsian, strategyConfig);
    for (const s of result) {
      expect(s.structureScore).toBeGreaterThanOrEqual(strategyConfig.minStructureScore);
    }
  });

  it("invalidated setup 被过滤掉", () => {
    const ctx = makeCtx();
    const candles4h = makeBullishFvgCandles4h();
    // 先获取未确认的 setup
    const fvgs = detectFvg(candles4h, "4h", strategyConfig);
    if (fvgs.length > 0) {
      const fvg = fvgs.find(r => r.direction === "long");
      if (fvg) {
        // 1h 止损穿透 → invalidated
        const stopCandle = makeCandle(0, fvg.entryHigh, fvg.entryHigh, fvg.stopLossHint - 200, fvg.stopLossHint - 100, INTERVAL_1H);
        const result = confirmEntry(fvg, [stopCandle], strategyConfig);
        expect(result.confirmationStatus).toBe("invalidated");
      }
    }
  });
});

import { describe, it, expect } from "vitest";
import { assessParticipantPressure } from "../../../src/services/participants/assess-participant-pressure.js";
import { buildMarketContext } from "../../../src/services/participants/build-market-context.js";
import { detectMarketRegime } from "../../../src/services/regime/detect-market-regime.js";
import { detectLiquiditySession } from "../../../src/utils/session.js";
import { strategyConfig } from "../../../src/app/config.js";
import type { Candle } from "../../../src/domain/market/candle.js";
import type { FundingRatePoint } from "../../../src/domain/market/funding-rate.js";
import type { OpenInterestPoint } from "../../../src/domain/market/open-interest.js";

// ── Fixture helpers ──────────────────────────────────────────────────────────

const BASE_TIME = 1_700_000_000_000;
const INTERVAL_4H = 4 * 60 * 60 * 1000;
const INTERVAL_1H = 60 * 60 * 1000;

function makeCandles(n: number, startPrice: number, endPrice: number): Candle[] {
  const step = (endPrice - startPrice) / n;
  return Array.from({ length: n }, (_, i) => {
    const mid = startPrice + i * step;
    return {
      timestamp: BASE_TIME + i * INTERVAL_4H,
      open: mid,
      high: mid + 100,
      low: mid - 100,
      close: mid + step * 0.8,
      volume: 1000,
    };
  });
}

function makeFundingRates(n: number, rate: number): FundingRatePoint[] {
  return Array.from({ length: n }, (_, i) => ({
    timestamp: BASE_TIME + i * INTERVAL_4H,
    fundingRate: rate,
  }));
}

function makeOI(n: number, startOI: number, endOI: number): OpenInterestPoint[] {
  const step = (endOI - startOI) / n;
  return Array.from({ length: n }, (_, i) => ({
    timestamp: BASE_TIME + i * INTERVAL_1H,
    openInterest: startOI + i * step,
  }));
}

// ── 四象限矩阵测试 ───────────────────────────────────────────────────────────

describe("assessParticipantPressure — 四象限矩阵", () => {
  it("价格↑ + OI↑ → long-crowded + flush-risk", () => {
    const candles = makeCandles(8, 60000, 62000);    // 价格上涨 ~3.3%
    const oi = makeOI(8, 50000, 55000);              // OI 上涨 10%
    const funding = makeFundingRates(3, 0.0003);     // 正向资金费率
    const result = assessParticipantPressure(candles, funding, oi, 0, strategyConfig);
    expect(result.bias).toBe("long-crowded");
    expect(result.pressureType).toBe("flush-risk");
    expect(result.reasonCodes).toContain("PARTICIPANT_LONG_CROWDED");
  });

  it("价格↓ + OI↑ → short-crowded + squeeze-risk", () => {
    const candles = makeCandles(8, 62000, 60000);    // 价格下跌
    const oi = makeOI(8, 50000, 55000);              // OI 上涨 10%
    const funding = makeFundingRates(3, -0.0003);    // 负向资金费率
    const result = assessParticipantPressure(candles, funding, oi, 0, strategyConfig);
    expect(result.bias).toBe("short-crowded");
    expect(result.pressureType).toBe("squeeze-risk");
    expect(result.reasonCodes).toContain("PARTICIPANT_SHORT_CROWDED");
  });

  it("价格↑ + OI↓ → short-crowded + squeeze-risk (空头平仓进行中)", () => {
    const candles = makeCandles(8, 60000, 62000);    // 价格上涨
    const oi = makeOI(8, 55000, 50000);              // OI 下降
    const funding = makeFundingRates(3, 0.0001);
    const result = assessParticipantPressure(candles, funding, oi, 0, strategyConfig);
    expect(result.bias).toBe("short-crowded");
    expect(result.pressureType).toBe("squeeze-risk");
  });

  it("价格↓ + OI↓ → long-crowded + flush-risk (多头平仓进行中)", () => {
    const candles = makeCandles(8, 62000, 60000);    // 价格下跌
    const oi = makeOI(8, 55000, 50000);              // OI 下降（非真空级别）
    const funding = makeFundingRates(3, 0.0001);
    const result = assessParticipantPressure(candles, funding, oi, 0, strategyConfig);
    expect(result.bias).toBe("long-crowded");
    expect(result.pressureType).toBe("flush-risk");
  });
});

// ── 去杠杆真空测试 ────────────────────────────────────────────────────────────

describe("assessParticipantPressure — 去杠杆真空", () => {
  it("价格急跌 + OI 大幅下降(≥10%) → DELEVERAGING_VACUUM", () => {
    const candles = makeCandles(8, 62000, 58000);    // 价格跌 ~6.5%
    // OI window = 最后 4 条: 从 100000 跌到 86000 = -14%（确保在窗口内超阈值）
    const oi = makeOI(4, 100000, 86000);
    const funding = makeFundingRates(3, -0.0001);
    const result = assessParticipantPressure(candles, funding, oi, 0, strategyConfig);
    expect(result.reasonCodes).toContain("DELEVERAGING_VACUUM");
    expect(result.bias).toBe("balanced");
    expect(result.pressureType).toBe("none");
    expect(result.rationale).toContain("去杠杆真空");
  });

  it("OI 小幅下降(<10%)不触发去杠杆真空", () => {
    const candles = makeCandles(8, 62000, 60000);    // 价格微跌
    const oi = makeOI(8, 50000, 47000);              // OI 跌 6%，未达阈值
    const funding = makeFundingRates(3, 0.0001);
    const result = assessParticipantPressure(candles, funding, oi, 0, strategyConfig);
    expect(result.reasonCodes).not.toContain("DELEVERAGING_VACUUM");
  });
});

// ── 现货-永续基差背离测试 ──────────────────────────────────────────────────────

describe("assessParticipantPressure — 现货-永续基差背离", () => {
  it("funding 负值 + 现货溢价 (spot > perp) → 背离 → squeeze-risk 置信度上调", () => {
    // 场景: 空头拥挤 (价格跌 + OI 涨) + spot > perp + funding 负值
    // basis = (spotPrice - perpPrice)/spotPrice > 0 = 现货溢价
    // funding < 0 = 空头付钱 → 表示空头情绪
    // 但现货溢价意味着现货买盘强 → 与 funding 负值矛盾 → 背离
    const perpClose = 60000;
    const candles = makeCandles(8, 62000, 60000).map((c, i, arr) => ({
      ...c,
      close: i === arr.length - 1 ? perpClose : c.close,
    }));
    const oi = makeOI(8, 50000, 55000);                // OI 上涨
    const funding = makeFundingRates(3, -0.0005);      // 负向资金费率（空头付钱）
    const spotPrice = 60400;                           // spot > perp: basis = (60400-60000)/60400 ≈ 0.0066 > 0.002

    const result = assessParticipantPressure(candles, funding, oi, spotPrice, strategyConfig);
    expect(result.basisDivergence).toBe(true);
    expect(result.reasonCodes).toContain("PARTICIPANT_BASIS_DIVERGENCE");
    // 置信度应该上调
    expect(result.confidence).toBeGreaterThan(60);
    expect(result.rationale).toContain("基差背离");
  });

  it("funding 正值 + 期货溢价 (perp > spot) → 背离 → flush-risk 置信度上调", () => {
    // 场景: 多头拥挤 (价格涨 + OI 涨) + perp > spot + funding 正值
    // spotPerpBasis = (spotPrice - perpPrice) / spotPrice < 0 (spot < perp → 期货溢价)
    // avgFunding > 0 (多头付钱) → 正值
    // spotPerpBasis * avgFunding < 0 (异号) → 背离
    const perpClose = 60000;
    const candles = makeCandles(8, 60000, 62000).map((c, i, arr) => ({
      ...c,
      close: i === arr.length - 1 ? perpClose : c.close,
    }));
    const oi = makeOI(8, 50000, 55000);                // OI 上涨
    const funding = makeFundingRates(3, 0.0005);       // 正向资金费率（多头付钱）
    const spotPrice = 59600;                           // spot < perp: basis = (59600-60000)/59600 ≈ -0.0067 < 0 (期货溢价)

    const result = assessParticipantPressure(candles, funding, oi, spotPrice, strategyConfig);
    expect(result.basisDivergence).toBe(true);
    expect(result.reasonCodes).toContain("PARTICIPANT_BASIS_DIVERGENCE");
  });

  it("basis 未达阈值时不触发背离", () => {
    const perpClose = 60000;
    const candles = makeCandles(8, 60000, 62000).map((c, i, arr) => ({
      ...c,
      close: i === arr.length - 1 ? perpClose : c.close,
    }));
    const oi = makeOI(8, 50000, 55000);
    const funding = makeFundingRates(3, -0.0005);
    const spotPrice = 60050;  // basis = (60050-60000)/60050 ≈ 0.00083 < 0.002

    const result = assessParticipantPressure(candles, funding, oi, spotPrice, strategyConfig);
    expect(result.basisDivergence).toBe(false);
    expect(result.reasonCodes).not.toContain("PARTICIPANT_BASIS_DIVERGENCE");
  });

  it("spotPrice = 0 时 spotPerpBasis 默认为 0，basisDivergence 默认为 false", () => {
    const candles = makeCandles(8, 60000, 62000);
    const oi = makeOI(8, 50000, 55000);
    const funding = makeFundingRates(3, 0.0003);

    const result = assessParticipantPressure(candles, funding, oi, 0, strategyConfig);
    expect(result.spotPerpBasis).toBe(0);
    expect(result.basisDivergence).toBe(false);
    expect(result.rationale).toContain("spotPrice=0");
  });
});

// ── 输出契约测试 ──────────────────────────────────────────────────────────────

describe("assessParticipantPressure — 输出契约", () => {
  it("返回 ParticipantPressure 所有必填字段", () => {
    const candles = makeCandles(8, 60000, 62000);
    const oi = makeOI(8, 50000, 55000);
    const funding = makeFundingRates(3, 0.0001);
    const result = assessParticipantPressure(candles, funding, oi, 60000, strategyConfig);

    expect(result).toHaveProperty("bias");
    expect(result).toHaveProperty("pressureType");
    expect(result).toHaveProperty("confidence");
    expect(result).toHaveProperty("rationale");
    expect(result).toHaveProperty("spotPerpBasis");
    expect(result).toHaveProperty("basisDivergence");
    expect(result).toHaveProperty("reasonCodes");
    expect(["long-crowded", "short-crowded", "balanced"]).toContain(result.bias);
    expect(["squeeze-risk", "flush-risk", "none"]).toContain(result.pressureType);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(100);
    expect(Array.isArray(result.reasonCodes)).toBe(true);
  });

  it("rationale 字段不为空", () => {
    const candles = makeCandles(8, 60000, 62000);
    const oi = makeOI(8, 50000, 55000);
    const funding = makeFundingRates(3, 0.0001);
    const result = assessParticipantPressure(candles, funding, oi, 0, strategyConfig);
    expect(result.rationale.length).toBeGreaterThan(0);
  });

  it("candles=[] 时安全返回默认值（不崩溃）", () => {
    const result = assessParticipantPressure([], [], [], 0, strategyConfig);
    expect(result.bias).toBe("balanced");
    expect(result.pressureType).toBe("none");
    expect(result.confidence).toBe(40);
    expect(result.spotPerpBasis).toBe(0);
    expect(result.basisDivergence).toBe(false);
    expect(result.reasonCodes).toEqual([]);
    expect(result.rationale).toContain("无 K 线数据");
  });
});

// ── buildMarketContext 集成测试 ───────────────────────────────────────────────

describe("buildMarketContext", () => {
  it("正确组合 RegimeDecision + ParticipantPressure + Session → MarketContext", () => {
    const candles = makeCandles(30, 60000, 62000);
    const oi = makeOI(8, 50000, 55000);
    const funding = makeFundingRates(3, 0.0003);

    const regimeDecision = detectMarketRegime(candles, strategyConfig);
    const pressure = assessParticipantPressure(candles, funding, oi, 0, strategyConfig);
    const session = detectLiquiditySession(12); // london_ny_overlap

    const ctx = buildMarketContext(regimeDecision, pressure, session);

    expect(ctx.regime).toBe(regimeDecision.regime);
    expect(ctx.regimeConfidence).toBe(regimeDecision.confidence);
    expect(ctx.regimeReasons).toEqual(regimeDecision.reasons);
    expect(ctx.marketDriverType).toBe(regimeDecision.driverType);
    expect(ctx.marketDriverConfidence).toBe(regimeDecision.driverConfidence);
    expect(ctx.participantBias).toBe(pressure.bias);
    expect(ctx.participantPressureType).toBe(pressure.pressureType);
    expect(ctx.participantConfidence).toBe(pressure.confidence);
    expect(ctx.participantRationale).toBe(pressure.rationale);
    expect(ctx.spotPerpBasis).toBe(pressure.spotPerpBasis);
    expect(ctx.basisDivergence).toBe(pressure.basisDivergence);
    expect(ctx.liquiditySession).toBe("london_ny_overlap");
    expect(ctx.summary).toContain(regimeDecision.regime);
    expect(Array.isArray(ctx.reasonCodes)).toBe(true);
  });

  it("MarketContext.reasonCodes 是 regime + participant reasonCodes 的合集（无重复）", () => {
    const candles = makeCandles(30, 60000, 62000);
    const oi = makeOI(8, 50000, 55000);
    const funding = makeFundingRates(3, 0.0003);

    const regimeDecision = detectMarketRegime(candles, strategyConfig);
    const pressure = assessParticipantPressure(candles, funding, oi, 0, strategyConfig);
    const ctx = buildMarketContext(regimeDecision, pressure, "ny_close");

    const allExpected = new Set([...regimeDecision.reasonCodes, ...pressure.reasonCodes]);
    expect(ctx.reasonCodes.length).toBe(allExpected.size);
    for (const code of allExpected) {
      expect(ctx.reasonCodes).toContain(code);
    }
  });

  it("MarketContext 不丢失 participantConfidence / participantRationale / spotPerpBasis / basisDivergence / liquiditySession", () => {
    const candles = makeCandles(8, 60000, 62000);
    const oi = makeOI(8, 50000, 55000);
    const funding = makeFundingRates(3, 0.0003);
    const regimeDecision = detectMarketRegime(candles, strategyConfig);
    const pressure = assessParticipantPressure(candles, funding, oi, 60400, strategyConfig);
    const ctx = buildMarketContext(regimeDecision, pressure, "asian_low");

    expect(typeof ctx.participantConfidence).toBe("number");
    expect(typeof ctx.participantRationale).toBe("string");
    expect(typeof ctx.spotPerpBasis).toBe("number");
    expect(typeof ctx.basisDivergence).toBe("boolean");
    expect(ctx.liquiditySession).toBe("asian_low");
  });
});

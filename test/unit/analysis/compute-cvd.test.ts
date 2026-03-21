import { describe, it, expect } from "vitest";
import {
  approxDelta,
  computeCVD,
  detectOrderFlowBias,
} from "../../../src/services/analysis/compute-cvd.js";
import type { Candle } from "../../../src/domain/market/candle.js";

// ── 测试辅助 ──────────────────────────────────────────────────────────────────

function candle(
  ts: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
): Candle {
  return { timestamp: ts * 3_600_000, open, high, low, close, volume };
}

/** 标准阳线：O=100 H=110 L=95 C=108 V=1000 */
const bullCandle = candle(0, 100, 110, 95, 108, 1000);
/** 标准阴线：O=100 H=105 L=90 C=93 V=1000 */
const bearCandle = candle(1, 100, 105, 90, 93, 1000);
/** 十字星：O=100 H=110 L=90 C=100 V=1000 */
const dojiCandle = candle(2, 100, 110, 90, 100, 1000);
/** 零价格区间 */
const flatCandle = candle(3, 100, 100, 100, 100, 1000);
/** 零成交量 */
const zeroVolCandle = candle(4, 95, 110, 90, 108, 0);

// ── approxDelta ───────────────────────────────────────────────────────────────

describe("approxDelta", () => {
  it("阳线返回正 delta（主动买入主导）", () => {
    const d = approxDelta(bullCandle);
    expect(d).toBeGreaterThan(0);
  });

  it("阴线返回负 delta（主动卖出主导）", () => {
    const d = approxDelta(bearCandle);
    expect(d).toBeLessThan(0);
  });

  it("十字星（close = open）返回 0", () => {
    expect(approxDelta(dojiCandle)).toBe(0);
  });

  it("价格区间为零返回 0（避免除以零）", () => {
    expect(approxDelta(flatCandle)).toBe(0);
  });

  it("成交量为零返回 0", () => {
    expect(approxDelta(zeroVolCandle)).toBe(0);
  });

  it("delta 量级 = |(close-open)/(high-low)| × volume", () => {
    // bullCandle: (108-100)/(110-95) × 1000 = 8/15 × 1000 ≈ 533.3
    expect(approxDelta(bullCandle)).toBeCloseTo((108 - 100) / (110 - 95) * 1000, 2);
  });

  it("delta 绝对值 ≤ volume", () => {
    // 由于 |close-open| ≤ high-low，delta ∈ [-volume, +volume]
    expect(Math.abs(approxDelta(bullCandle))).toBeLessThanOrEqual(bullCandle.volume);
    expect(Math.abs(approxDelta(bearCandle))).toBeLessThanOrEqual(bearCandle.volume);
  });
});

// ── computeCVD ────────────────────────────────────────────────────────────────

describe("computeCVD", () => {
  it("空数组返回空数组", () => {
    expect(computeCVD([])).toHaveLength(0);
  });

  it("返回与 candles 等长的序列", () => {
    const cs = [bullCandle, bearCandle, dojiCandle];
    expect(computeCVD(cs)).toHaveLength(3);
  });

  it("第一个元素 cumDelta = delta", () => {
    const result = computeCVD([bullCandle]);
    expect(result[0].cumDelta).toBeCloseTo(result[0].delta, 6);
  });

  it("cumDelta 是 delta 的前缀和", () => {
    const cs = [bullCandle, bearCandle, dojiCandle];
    const result = computeCVD(cs);
    const manualCum = [result[0].delta, result[0].delta + result[1].delta, result[0].delta + result[1].delta + result[2].delta];
    for (let i = 0; i < result.length; i++) {
      expect(result[i].cumDelta).toBeCloseTo(manualCum[i], 6);
    }
  });

  it("timestamp 与 candle 一致", () => {
    const cs = [bullCandle, bearCandle];
    const result = computeCVD(cs);
    expect(result[0].timestamp).toBe(bullCandle.timestamp);
    expect(result[1].timestamp).toBe(bearCandle.timestamp);
  });

  it("全阳线序列 cumDelta 单调递增", () => {
    const cs = Array.from({ length: 5 }, (_, i) => candle(i, 100, 110, 90, 108, 1000));
    const result = computeCVD(cs);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].cumDelta).toBeGreaterThan(result[i - 1].cumDelta);
    }
  });
});

// ── detectOrderFlowBias ───────────────────────────────────────────────────────

describe("detectOrderFlowBias", () => {
  it("空数组返回 neutral", () => {
    const r = detectOrderFlowBias([]);
    expect(r.bias).toBe("neutral");
    expect(r.cvdSlope).toBe(0);
  });

  it("K 线数量不足 window 返回 neutral（P2 Codex 修复）", () => {
    // 5 根 K 线 < 默认 window=20，应跳过分析
    const cs = Array.from({ length: 5 }, (_, i) => candle(i, 95, 110, 90, 108, 1000));
    const r = detectOrderFlowBias(cs);
    expect(r.bias).toBe("neutral");
    expect(r.cvdSlope).toBe(0);
    expect(r.reason).toMatch(/不足/);
  });

  it("全成交量为零返回 neutral", () => {
    const cs = Array.from({ length: 20 }, (_, i) => candle(i, 95, 110, 90, 108, 0));
    const r = detectOrderFlowBias(cs);
    expect(r.bias).toBe("neutral");
    expect(r.cvdSlope).toBe(0);
  });

  it("后半段买压强于前半段 → bullish（半窗口动量增强）", () => {
    // 前 10 根十字星（delta=0），后 10 根强阳线（delta≫0）
    // 半窗口对比：earlyDelta=0，lateDelta>0 → cvdSlope>0
    const cs = [
      ...Array.from({ length: 10 }, (_, i) => candle(i,    100, 110, 90, 100, 5_000)), // 十字星
      ...Array.from({ length: 10 }, (_, i) => candle(i+10, 100, 110, 98, 109, 5_000)), // 强阳线
    ];
    const r = detectOrderFlowBias(cs);
    expect(r.bias).toBe("bullish");
    expect(r.cvdSlope).toBeGreaterThan(0.05);
  });

  it("后半段卖压强于前半段 → bearish（半窗口动量减弱）", () => {
    // 前 10 根十字星，后 10 根强阴线
    const cs = [
      ...Array.from({ length: 10 }, (_, i) => candle(i,    100, 110, 90, 100, 5_000)), // 十字星
      ...Array.from({ length: 10 }, (_, i) => candle(i+10, 100, 102, 90,  91, 5_000)), // 强阴线
    ];
    const r = detectOrderFlowBias(cs);
    expect(r.bias).toBe("bearish");
    expect(r.cvdSlope).toBeLessThan(-0.05);
  });

  it("前后半段完全相同 → neutral（动能稳定）", () => {
    // 20 根相同强阳线：earlyDelta = lateDelta，deltaShift = 0
    const cs = Array.from({ length: 20 }, (_, i) =>
      candle(i, 100, 110, 98, 109, 5_000),
    );
    const r = detectOrderFlowBias(cs);
    expect(r.bias).toBe("neutral");
    expect(r.cvdSlope).toBe(0);
  });

  it("全十字星（delta=0）→ neutral", () => {
    const cs = Array.from({ length: 20 }, (_, i) =>
      candle(i, 100, 110, 90, 100, 5_000),
    );
    const r = detectOrderFlowBias(cs);
    expect(r.bias).toBe("neutral");
    expect(r.cvdSlope).toBe(0);
  });

  it("逆转场景：19根强阴 + 1根大阳 → bullish（P1 Codex修复验证）", () => {
    // 旧算法（净delta）：19阴主导，结果=bearish，错误压制逆转做多信号
    // 新算法（半窗口）：前10根阴线 vs 后10根（9根阴+1根大阳），如果大阳足够大则 bullish
    // 使用：前10阴（小量），后9阴+1超大阳（大量，delta覆盖9阴）
    const cs = [
      ...Array.from({ length: 10 }, (_, i) => candle(i,    100, 102, 90,  91, 1_000)), // 小阴线
      ...Array.from({ length: 9 },  (_, i) => candle(i+10, 100, 102, 90,  91, 1_000)), // 小阴线
      candle(19, 90, 115, 88, 114, 50_000), // 超大阳线，close接近high，delta极大
    ];
    const r = detectOrderFlowBias(cs);
    // 后段有超大阳线，lateDelta > earlyDelta → bullish
    expect(r.bias).toBe("bullish");
  });

  it("cvdSlope 归一化后绝对值 ≤ 1", () => {
    // 前半段全阴（-1方向），后半段全阳（+1方向），变化最大约 ≤ 1
    const cs = [
      ...Array.from({ length: 10 }, (_, i) => candle(i,    90, 110, 90, 90, 5_000)), // 极端阴
      ...Array.from({ length: 10 }, (_, i) => candle(i+10, 90, 110, 90, 110, 5_000)), // 极端阳
    ];
    const r = detectOrderFlowBias(cs);
    expect(Math.abs(r.cvdSlope)).toBeLessThanOrEqual(1);
  });

  it("自定义 window 只分析最近 N 根 K 线", () => {
    // 序列：10根十字星 + 10根强阳线
    // window=10：只看后10根强阳。half=5，前5阳 vs 后5阳 → earlyDelta=lateDelta → neutral
    // window=20：全部20根。half=10，前10十字星 vs 后10强阳 → lateDelta>earlyDelta → bullish
    const cs = [
      ...Array.from({ length: 10 }, (_, i) => candle(i,    100, 110, 90, 100, 5_000)), // 十字星
      ...Array.from({ length: 10 }, (_, i) => candle(i+10, 100, 110, 98, 109, 5_000)), // 强阳线
    ];
    const rTight = detectOrderFlowBias(cs, 10);  // 只看最后10根（全为强阳）
    const rFull  = detectOrderFlowBias(cs, 20);  // 完整20根

    // window=10：10根相同强阳，前5=后5 → neutral（动能稳定）
    expect(rTight.bias).toBe("neutral");
    // window=20：前10十字星 vs 后10强阳 → bullish（动能增强）
    expect(rFull.bias).toBe("bullish");
  });

  it("自定义 neutralThreshold 缩窄中性区间", () => {
    // 十字星前后 delta=0，无论阈值多小都 neutral
    const cs = Array.from({ length: 20 }, (_, i) =>
      candle(i, 100, 110, 90, 100, 1000),
    );
    expect(detectOrderFlowBias(cs, 20, 0.001).bias).toBe("neutral");
  });

  it("reason 字符串不为空", () => {
    const cs = Array.from({ length: 20 }, (_, i) => candle(i, 100, 110, 90, 100, 1000));
    const r = detectOrderFlowBias(cs);
    expect(r.reason.length).toBeGreaterThan(0);
  });
});

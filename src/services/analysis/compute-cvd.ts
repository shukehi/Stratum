import type { Candle } from "../../domain/market/candle.js";
import type {
  CandleDelta,
  OrderFlowBias,
  OrderFlowResult,
} from "../../domain/market/order-flow.js";

/**
 * CVD（累计成交量差）计算器  (PHASE_18)
 *
 * 算法说明：
 *   使用 Kaufman 近似公式将 OHLCV K 线转换为主动买卖方向估算。
 *   精度约 70%，满足日线/4h 信号过滤场景。对于需要高精度的
 *   高频交易场景，应使用逐笔成交数据（tick data）。
 */

/**
 * Kaufman 近似：从单根 K 线估算主动买卖差（delta）。
 *
 *   delta = (close - open) / (high - low) × volume
 *
 *   - 阳线（close > open）→ delta > 0（主动买入主导）
 *   - 阴线（close < open）→ delta < 0（主动卖出主导）
 *   - 十字星（close = open）→ delta = 0
 *   - 价格区间为零或成交量为零 → delta = 0（跳过异常数据）
 */
export function approxDelta(candle: Candle): number {
  const range = candle.high - candle.low;
  if (range <= 0 || candle.volume <= 0) return 0;
  return ((candle.close - candle.open) / range) * candle.volume;
}

/**
 * 计算 K 线序列的累计成交量差（CVD）序列。
 *
 * @param candles  K 线数组（时间升序）
 * @returns        与 candles 等长的 CandleDelta 数组
 */
export function computeCVD(candles: Candle[]): CandleDelta[] {
  let cumDelta = 0;
  return candles.map((c) => {
    const delta = approxDelta(c);
    cumDelta += delta;
    return { timestamp: c.timestamp, delta, cumDelta };
  });
}

/**
 * 检测给定 K 线窗口内的订单流偏向。
 *
 * 算法（半窗口动量对比）：
 *   将窗口一分为二（前半 / 后半），对比两段的净 delta 差值，
 *   衡量买卖动能是在增强还是减弱，而非仅看全窗口绝对方向。
 *
 *   earlyDelta = 前半段 Σ delta
 *   lateDelta  = 后半段 Σ delta
 *   cvdSlope   = (lateDelta - earlyDelta) / totalVolume（归一化，约 -1 ~ +1）
 *
 *   cvdSlope > +neutralThreshold  → bullish（后段买压强于前段，动能增强）
 *   cvdSlope < -neutralThreshold  → bearish（后段卖压强于前段，动能减弱）
 *   否则                          → neutral（动能稳定或无方向性变化）
 *
 * 为什么用半窗口而非全窗口净 delta：
 *   全窗口净 delta 对顺序不敏感（19根阴线+1根强阳线 ≈ 逆序结果相同），
 *   会将窗口末尾刚形成的反转信号判定为 ORDER_FLOW_COUNTER，
 *   错误降级正是 PHASE_18 目的在于确认的逆势突破信号。
 *
 * @param candles          K 线数组（时间升序）
 * @param window           分析窗口（最近 N 根 K 线，默认 20）
 * @param neutralThreshold 中性区间阈值（默认 0.05 = 5% 总成交量）
 */
export function detectOrderFlowBias(
  candles: Candle[],
  window = 20,
  neutralThreshold = 0.05,
): OrderFlowResult {
  if (candles.length === 0) {
    return { bias: "neutral", cvdSlope: 0, reason: "无 K 线数据，跳过订单流分析" };
  }

  const recent = candles.slice(-window);

  // 样本不足时返回 neutral，避免少量 K 线产生虚假偏向
  if (recent.length < window) {
    return {
      bias: "neutral",
      cvdSlope: 0,
      reason: `K 线数量不足（${recent.length}/${window}），跳过订单流分析`,
    };
  }

  const totalVolume = recent.reduce((s, c) => s + c.volume, 0);
  if (totalVolume === 0) {
    return { bias: "neutral", cvdSlope: 0, reason: "窗口内成交量为零，跳过订单流分析" };
  }

  // ── 半窗口动量对比 ────────────────────────────────────────────────────────
  const half = Math.floor(recent.length / 2);
  const earlyDelta = recent.slice(0, half).reduce((s, c) => s + approxDelta(c), 0);
  const lateDelta  = recent.slice(half).reduce((s, c) => s + approxDelta(c), 0);
  const cvdSlope   = (lateDelta - earlyDelta) / totalVolume;

  if (cvdSlope > neutralThreshold) {
    const pct = (cvdSlope * 100).toFixed(1);
    return {
      bias: "bullish",
      cvdSlope,
      reason: `CVD动量增强 +${pct}%（后半段买压＞前半段，阈值 ±${(neutralThreshold * 100).toFixed(0)}%）`,
    };
  }

  if (cvdSlope < -neutralThreshold) {
    const pct = (Math.abs(cvdSlope) * 100).toFixed(1);
    return {
      bias: "bearish",
      cvdSlope,
      reason: `CVD动量减弱 -${pct}%（后半段卖压＞前半段，阈值 ±${(neutralThreshold * 100).toFixed(0)}%）`,
    };
  }

  const pct = (cvdSlope * 100).toFixed(1);
  return {
    bias: "neutral",
    cvdSlope,
    reason: `CVD动量 ${pct}% 在中性区间（±${(neutralThreshold * 100).toFixed(0)}%），买卖动能稳定`,
  };
}

export type CvdAccelerationResult = {
  isAccelerating: boolean;  // CVD 是否在加速（动能增强）
  accelerationScore: number; // 加速度评分（0–100）
  direction: "bullish" | "bearish" | "neutral";
  cvdSlope: number;
};

/**
 * 计算 CVD 加速度（动能变化率）
 * 将窗口三等分，对比最后 1/3 与前 2/3 的 CVD 斜率变化
 */
export function computeCvdAcceleration(
  candles: Candle[],
  window = 12
): CvdAccelerationResult {
  const recent = candles.slice(-window);
  if (recent.length < 6) {
    return { isAccelerating: false, accelerationScore: 50, direction: "neutral", cvdSlope: 0 };
  }

  const third = Math.floor(recent.length / 3);
  const earlyCandles = recent.slice(0, third * 2);
  const lateCandles  = recent.slice(third * 2);

  const totalVol = recent.reduce((s, c) => s + c.volume, 0) || 1;
  const earlyDelta = earlyCandles.reduce((s, c) => s + approxDelta(c), 0);
  const lateDelta  = lateCandles.reduce((s, c) => s + approxDelta(c), 0);

  // 归一化斜率：后段比前段的动能变化
  const earlySlope = earlyDelta / (totalVol * 2 / 3);
  const lateSlope  = lateDelta  / (totalVol * 1 / 3);
  const acceleration = lateSlope - earlySlope;

  const direction: "bullish" | "bearish" | "neutral" =
    lateSlope > 0.03 ? "bullish" : lateSlope < -0.03 ? "bearish" : "neutral";

  const isAccelerating = Math.abs(lateSlope) > Math.abs(earlySlope) * 1.2;
  const accelerationScore = Math.min(100, 50 + Math.abs(acceleration) * 500);

  return { isAccelerating, accelerationScore, direction, cvdSlope: lateSlope };
}

/** 导出类型别名，方便外部使用 */
export type { CandleDelta, OrderFlowBias, OrderFlowResult };

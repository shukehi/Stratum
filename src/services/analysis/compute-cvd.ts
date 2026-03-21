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
 * 判断逻辑：
 *   windowNetDelta = Σ delta（窗口内所有 K 线）
 *   cvdSlope = windowNetDelta / windowTotalVolume （归一化，范围约 -1 ~ +1）
 *
 *   cvdSlope > +neutralThreshold  → bullish（净主动买入 > N% 成交量）
 *   cvdSlope < -neutralThreshold  → bearish（净主动卖出 > N% 成交量）
 *   否则                          → neutral（买卖双方相对均衡）
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

  const totalVolume = recent.reduce((s, c) => s + c.volume, 0);
  if (totalVolume === 0) {
    return { bias: "neutral", cvdSlope: 0, reason: "窗口内成交量为零，跳过订单流分析" };
  }

  const netDelta = recent.reduce((s, c) => s + approxDelta(c), 0);
  const cvdSlope = netDelta / totalVolume;

  if (cvdSlope > neutralThreshold) {
    const pct = (cvdSlope * 100).toFixed(1);
    return {
      bias: "bullish",
      cvdSlope,
      reason: `CVD净多头占比 ${pct}%（阈值 ±${(neutralThreshold * 100).toFixed(0)}%），主动买入主导`,
    };
  }

  if (cvdSlope < -neutralThreshold) {
    const pct = (Math.abs(cvdSlope) * 100).toFixed(1);
    return {
      bias: "bearish",
      cvdSlope,
      reason: `CVD净空头占比 ${pct}%（阈值 ±${(neutralThreshold * 100).toFixed(0)}%），主动卖出主导`,
    };
  }

  const pct = (cvdSlope * 100).toFixed(1);
  return {
    bias: "neutral",
    cvdSlope,
    reason: `CVD斜率 ${pct}% 在中性区间（±${(neutralThreshold * 100).toFixed(0)}%），买卖双方均衡`,
  };
}

/** 导出类型别名，方便外部使用 */
export type { CandleDelta, OrderFlowBias, OrderFlowResult };

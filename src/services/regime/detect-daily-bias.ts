import type { Candle } from "../../domain/market/candle.js";
import type { DailyBias, DailyBiasResult } from "../../domain/market/daily-bias.js";

/**
 * 日线趋势检测器  (PHASE_16)
 *
 * 使用 EMA20 / EMA50 双均线交叉法识别日线级别的主趋势方向，
 * 作为 4h 信号的高级别趋势过滤器。
 *
 * 判断规则（第一性原理，顺序应用）:
 *   数据不足（< 50 根）→ neutral（信息不足，不干扰信号）
 *   EMA 间距 < separationThreshold → neutral（均线粘合，无趋势）
 *   EMA20 > EMA50 AND close > EMA20 → bullish（趋势上升且价格在均线上方）
 *   EMA20 < EMA50 AND close < EMA20 → bearish（趋势下降且价格在均线下方）
 *   其他（EMA 分叉但价格站错侧）  → neutral（过渡/回调区域）
 *
 * EMA 计算（指数移动平均）:
 *   k = 2 / (period + 1)
 *   EMA_t = close_t * k + EMA_{t-1} * (1 - k)
 *   初始值 = 前 period 根的 SMA
 *
 * separationThreshold（默认 0.005 = 0.5%）:
 *   |(EMA20 - EMA50) / EMA50| < 0.5% → 视为均线粘合 → neutral
 *   避免在均线交叉瞬间产生误判
 */
export function detectDailyBias(
  candles1d: Candle[],
  separationThreshold = 0.005
): DailyBiasResult {
  const NEUTRAL: DailyBiasResult = {
    bias: "neutral",
    ema20: 0,
    ema50: 0,
    latestClose: candles1d.at(-1)?.close ?? 0,
    separation: 0,
    reason: "数据不足（< 50 根日线），无法判断日线趋势，默认中性",
  };

  if (candles1d.length < 50) return NEUTRAL;

  const closes = candles1d.map(c => c.close);
  const ema20 = computeEma(closes, 20);
  const ema50 = computeEma(closes, 50);
  const latestClose = closes[closes.length - 1];

  // EMA 间距（相对于 EMA50）
  const separation = (ema20 - ema50) / ema50;

  // 均线粘合 → neutral
  if (Math.abs(separation) < separationThreshold) {
    return {
      bias: "neutral",
      ema20,
      ema50,
      latestClose,
      separation,
      reason: `EMA20/EMA50 间距 ${(separation * 100).toFixed(2)}% < 阈值 ${(separationThreshold * 100).toFixed(1)}%，视为均线粘合，中性`,
    };
  }

  if (ema20 > ema50 && latestClose > ema20) {
    return {
      bias: "bullish",
      ema20,
      ema50,
      latestClose,
      separation,
      reason: `EMA20(${ema20.toFixed(0)}) > EMA50(${ema50.toFixed(0)})，收盘价 ${latestClose.toFixed(0)} 在 EMA20 上方，日线看涨`,
    };
  }

  if (ema20 < ema50 && latestClose < ema20) {
    return {
      bias: "bearish",
      ema20,
      ema50,
      latestClose,
      separation,
      reason: `EMA20(${ema20.toFixed(0)}) < EMA50(${ema50.toFixed(0)})，收盘价 ${latestClose.toFixed(0)} 在 EMA20 下方，日线看跌`,
    };
  }

  // EMA 已分叉但价格在中间区域（回调/反弹过渡期）
  const side = ema20 > ema50 ? "看涨" : "看跌";
  return {
    bias: "neutral",
    ema20,
    ema50,
    latestClose,
    separation,
    reason: `EMA 呈 ${side} 排列但价格处于过渡区，视为中性`,
  };
}

// ── EMA 计算 ──────────────────────────────────────────────────────────────────

/**
 * 计算 EMA（指数移动平均），初始值用前 period 根的 SMA。
 * 返回最后一根 K 线对应的 EMA 值。
 */
export function computeEma(closes: number[], period: number): number {
  if (closes.length < period) return closes[closes.length - 1] ?? 0;

  const k = 2 / (period + 1);

  // 初始值：前 period 根的 SMA
  let ema = closes.slice(0, period).reduce((s, v) => s + v, 0) / period;

  // 从第 period 根开始递推
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }

  return ema;
}

/**
 * 日线趋势偏向  (PHASE_16)
 *
 * 基于 1d K线 EMA 分析得出的大周期方向。
 *   bullish  — EMA20 > EMA50，价格在 EMA20 上方，日线上升趋势
 *   bearish  — EMA20 < EMA50，价格在 EMA20 下方，日线下降趋势
 *   neutral  — EMA 交叉附近或震荡，无明确方向
 */
export type DailyBias = "bullish" | "bearish" | "neutral";

export type DailyBiasResult = {
  bias: DailyBias;
  ema20: number;       // 最新 EMA20 值
  ema50: number;       // 最新 EMA50 值
  latestClose: number; // 最新收盘价
  separation: number;  // EMA20 与 EMA50 的百分比偏离（正=EMA20在上）
  reason: string;      // 可读说明
};

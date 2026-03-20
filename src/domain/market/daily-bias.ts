/**
 * 日线市场结构偏向  (PHASE_16 — 修订版)
 *
 * 基于 1d K线的摆高/摆低序列判断大周期结构方向。
 * 不依赖滞后指标（EMA），而是直接读取价格结构。
 *
 *   bullish  — HH + HL（更高的高点 + 更高的低点）→ 多头结构
 *   bearish  — LH + LL（更低的高点 + 更低的低点）→ 空头结构
 *   neutral  — 结构混乱或数据不足，不干扰信号
 */
export type DailyBias = "bullish" | "bearish" | "neutral";

/**
 * 市场结构类型（由最近两个摆高 + 两个摆低决定）
 *   HH_HL  — Higher High + Higher Low → 多头结构（最强看涨）
 *   LH_LL  — Lower High  + Lower Low  → 空头结构（最强看跌）
 *   HH_LL  — Higher High + Lower Low  → 膨胀区间（方向混乱）
 *   LH_HL  — Lower High  + Higher Low → 收敛区间（多空博弈）
 *   insufficient — 有效枢纽点不足，无法判断结构
 */
export type MarketStructure =
  | "HH_HL"
  | "LH_LL"
  | "HH_LL"
  | "LH_HL"
  | "insufficient";

export type DailyBiasResult = {
  bias: DailyBias;
  structure: MarketStructure;
  lastSwingHigh: number | null; // 最近一个已确认的摆高价格
  lastSwingLow: number | null;  // 最近一个已确认的摆低价格
  latestClose: number;          // 最新收盘价
  reason: string;               // 可读说明
};

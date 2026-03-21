/**
 * 订单流分析类型定义  (PHASE_18)
 *
 * 第一性原理：
 *   价格由主动买单（market buy）与主动卖单（market sell）的失衡驱动。
 *   CVD（累计成交量差）= Σ主动买入量 - Σ主动卖出量
 *   CVD 上升 → 买方持续强于卖方 → 真实上升动能
 *   CVD 下降 → 卖方持续强于买方 → 真实下降动能
 *   价格上涨但 CVD 下降 → 假突破（卖方在吸收买压）→ 过滤此信号
 *
 * Kaufman 近似公式（无 tick 数据时）：
 *   delta ≈ (close - open) / (high - low) × volume
 *   精度约 70%，满足 4h 信号过滤需求。
 */

/** 单根 K 线的近似主动买卖差 + 累计序列 */
export type CandleDelta = {
  timestamp: number;
  /** 单根 K 线净 delta（正 = 净主动买入，负 = 净主动卖出） */
  delta: number;
  /** 从序列起点累计的 CVD */
  cumDelta: number;
};

/** CVD 方向偏向 */
export type OrderFlowBias = "bullish" | "bearish" | "neutral";

/** detectOrderFlowBias 输出 */
export type OrderFlowResult = {
  bias: OrderFlowBias;
  /** 归一化 CVD 斜率 = 窗口净 delta / 窗口总成交量（范围约 -1 ~ +1） */
  cvdSlope: number;
  reason: string;
};

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

/**
 * CVD 动量偏向（半窗口算法语义）
 *
 * ⚠️  注意：这里的 "bullish"/"bearish" 表示买卖动能的**变化方向**，
 *     而非市场当前绝对的多空主导方向。
 *
 *   "bullish"  = 后半窗口买压 > 前半窗口买压（动能在增强）
 *              ≠ 净成交量多头主导
 *              = 适合确认"卖方力量正在衰竭 → 逆势做多"场景
 *
 *   "bearish"  = 后半窗口卖压 > 前半窗口卖压（动能在减弱）
 *              = 适合确认"买方力量正在衰竭 → 逆势做空"场景
 *
 *   "neutral"  = 前后半段动能相近，或样本不足
 *
 * 设计意图：确认逆势突破（sweep/FVG 反转）入场信号，而非判断趋势方向。
 * 若需判断趋势方向，应使用 Volume Profile 日线偏向（PHASE_17）。
 */
export type OrderFlowBias = "bullish" | "bearish" | "neutral";

/** detectOrderFlowBias 输出 */
export type OrderFlowResult = {
  bias: OrderFlowBias;
  /**
   * 归一化 CVD 加速度 = (lateDelta - earlyDelta) / totalVolume（范围约 -1 ~ +1）
   * 正值 = 后半段买压强于前半段；负值 = 后半段卖压强于前半段
   * 注意：这是动量变化量，不是绝对 CVD 方向。
   */
  cvdSlope: number;
  reason: string;
};

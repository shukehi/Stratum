/**
 * 等高等低（Equal Highs / Equal Lows）类型定义  (PHASE_19)
 *
 * 第一性原理：
 *   多根 K 线的高点（或低点）在容差范围内重合，意味着止损单在
 *   该价位极度集中。机构比普通 swing 高低点更优先扫描这类区域。
 *
 *   Equal Highs → 止损密集区（空头止损 + 突破买单）→ 被扫描后看跌
 *   Equal Lows  → 止损密集区（多头止损 + 跌破卖单）→ 被扫描后看涨
 *
 * 与普通 swing 高低点的区别：
 *   普通 swing：单一局部极值，代表单次止损聚集
 *   Equal H/L：多次测试同一价位均失败突破，代表止损极度密集
 *              → 机构扫描优先级更高 → 结构评分加成更强
 */

/** 等高或等低区域 */
export type EqualLevel = {
  /** 区域类型：high = 等高，low = 等低 */
  type: "high" | "low";
  /**
   * 代表价格（区域内所有触碰价格的均值）
   * 用于与 setup 入场区间对比
   */
  price: number;
  /** 触碰次数（触及该价位的 swing 点数量，≥ minCount） */
  touchCount: number;
  /** 区域内最早一次触碰的时间戳（毫秒） */
  firstTimestamp: number;
  /** 区域内最近一次触碰的时间戳（毫秒） */
  lastTimestamp: number;
  /**
   * 实际使用的容差（绝对价格值 = price × tolerancePct）
   * 用于判断 setup 是否落在该等高等低区域范围内
   */
  toleranceAbsolute: number;
};

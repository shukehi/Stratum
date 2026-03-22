/**
 * 市场主导驱动类型。
 *
 * 用于描述当前价格行为更像是“新增仓位推动”，还是“已有仓位被动平仓”
 * 所造成的结果，供市场状态解释与日志审计使用。
 */
export type MarketDriverType =
  | "new-longs"
  | "new-shorts"
  | "short-covering"
  | "long-liquidation"
  | "deleveraging-vacuum"
  | "unclear";

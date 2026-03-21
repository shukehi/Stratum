/**
 * Volume Profile — 成交量分布  (PHASE_17)
 *
 * Volume Profile 是比 K 线均线更接近第一性原理的分析工具：
 *   - VPOC（成交量中心价）= 机构认为的"公允价值"
 *   - 价值区间（VAH/VAL） = 70% 成交量发生的价格区间
 *   - HVN（高成交量节点） = 机构大量成交处 → 强支撑/阻力
 *   - LVN（低成交量节点） = 价格快速穿越处 → 真空带，预期快速移动
 *
 * 与 K 线时间框架无关——它反映的是价格与成交量的关系，
 * 而不是时间与价格的关系。
 */

/** 单个价格桶（价格区间 + 该区间内的成交量） */
export type VPBucket = {
  priceLow: number;   // 桶的价格下界
  priceHigh: number;  // 桶的价格上界
  priceMid: number;   // 桶的中间价（= (low + high) / 2）
  volume: number;     // 分配到该桶的成交量
};

/** 完整的 Volume Profile 结果 */
export type VolumeProfile = {
  vpoc: number;        // 成交量中心价（Volume Point of Control）
  vah: number;         // 价值区间上限（Value Area High，覆盖 valueAreaPercent% 成交量上界）
  val: number;         // 价值区间下限（Value Area Low）
  hvn: number[];       // 高成交量节点价格列表（midPrice）
  lvn: number[];       // 低成交量节点价格列表（midPrice）
  totalVolume: number; // 统计区间内的总成交量
  buckets: VPBucket[]; // 完整桶序列（从低到高排列）
  priceMin: number;    // 统计区间的最低价
  priceMax: number;    // 统计区间的最高价
};

/**
 * 基于 Volume Profile 的日线价格区域。
 *
 *   premium    — 价格高于价值区间上限（VAH），溢价区，倾向回归公允价值（偏空）
 *   equilibrium — 价格在价值区间内（VAL ~ VAH），均衡区，双向机会
 *   discount   — 价格低于价值区间下限（VAL），折价区，倾向回归公允价值（偏多）
 */
export type PriceZone = "premium" | "equilibrium" | "discount";

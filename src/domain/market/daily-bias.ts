/**
 * 日线价格偏向  (PHASE_17 — Volume Profile 版本)
 *
 * 基于 Volume Profile（成交量分布）判断价格处于溢价区、折价区还是均衡区。
 *
 * 第一性原理：
 *   机构在大量成交的价格区间（价值区间 VAL~VAH）视为"公允价值"。
 *   价格高于 VAH（溢价）→ 距公允价值偏贵，倾向回落 → bearish
 *   价格低于 VAL（折价）→ 距公允价值偏便宜，倾向回升 → bullish
 *   价格在 VAL~VAH 内（均衡）→ 双方都接受此价格，方向不明 → neutral
 *
 * 不依赖时间框架（EMA/摆高摆低都是时间相关的）；
 * 完全基于成交量与价格的关系——这是市场行为的直接体现。
 */
export type DailyBias = "bullish" | "bearish" | "neutral";

/** 价格区域（相对于 Volume Profile 价值区间）— 定义在 volume-profile.ts，此处重导出供外部消费 */
import type { PriceZone as _PriceZone } from "./volume-profile.js";
export type PriceZone = _PriceZone;

/** Volume Profile 日线偏向结果 */
export type DailyBiasResult = {
  bias: DailyBias;
  priceZone: PriceZone;   // 价格区域（溢价/均衡/折价）
  vpoc: number;           // 成交量中心价（公允价值锚点）
  vah: number;            // 价值区间上限
  val: number;            // 价值区间下限
  latestClose: number;    // 最新收盘价
  reason: string;         // 可读说明
};

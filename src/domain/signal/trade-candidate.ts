// PHASE_02 已冻结：不要修改字段定义
import type { ReasonCode } from "../common/reason-code.js";

/**
 * 资本周转期望得分 (Capital Velocity Score - CVS)
 * 
 * 物理意义：
 *   基于 (结构强度 * 动能爆发力 * 盈亏比) 计算出的资本周转潜力。
 *   不再使用主观的评级标签，而是使用纯粹的实数进行竞争置换。
 */
export type TradeCandidate = {
  symbol: string;
  direction: "long" | "short";
  timeframe: "4h" | "1h";
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  regimeAligned: boolean;
  participantAligned: boolean;
  structureReason: string;
  contextReason: string;
  capitalVelocityScore: number; // 核心物理量：资本周转期望
  reasonCodes: ReasonCode[];
};

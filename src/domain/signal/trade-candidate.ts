// PHASE_02 已冻结：不要修改字段定义
import type { ReasonCode } from "../common/reason-code.js";

export type SignalGrade = "watch" | "standard" | "high-conviction";

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
  macroReason?: string;
  signalGrade: SignalGrade;
  reasonCodes: ReasonCode[];
};

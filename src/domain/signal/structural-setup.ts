// PHASE_02 已冻结：不要修改字段定义
import type { ReasonCode } from "../common/reason-code.js";

export type ConfluenceFactor =
  | "fvg"
  | "swing-high-low"
  | "liquidity-pool"
  | "high-volume-node"
  | "liquidity-sweep";

export type StructuralSetup = {
  timeframe: "4h" | "1h";
  direction: "long" | "short";
  entryLow: number;
  entryHigh: number;
  stopLossHint: number;
  takeProfitHint: number;
  structureScore: number;
  structureReason: string;
  invalidationReason: string;
  confluenceFactors: ConfluenceFactor[];
  confirmationStatus: "pending" | "confirmed" | "invalidated";
  confirmationTimeframe: "1h";
  reasonCodes: ReasonCode[];
};

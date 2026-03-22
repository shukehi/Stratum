// PHASE_02 已冻结：不要修改字段定义
import type { ReasonCode } from "../common/reason-code.js";

export type MacroAssessment = {
  macroBias: "bullish" | "bearish" | "neutral";
  confidenceScore: number;
  btcRelevance: number;
  catalystSummary: string;
  riskFlags: string[];
  rawPrompt: string;
  rawResponse: string;
};

export type MacroOverlayDecision = {
  action: "pass" | "downgrade" | "block";
  confidence: number;
  reason: string;
  reasonCodes: ReasonCode[];
};

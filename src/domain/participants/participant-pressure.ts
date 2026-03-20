// PHASE_02 FROZEN - do not modify fields
import type { ReasonCode } from "../common/reason-code.js";

export type ParticipantPressure = {
  bias: "long-crowded" | "short-crowded" | "balanced";
  pressureType: "squeeze-risk" | "flush-risk" | "none";
  confidence: number;
  rationale: string;
  spotPerpBasis: number;
  basisDivergence: boolean;
  reasonCodes: ReasonCode[];
};

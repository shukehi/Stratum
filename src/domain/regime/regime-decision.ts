// PHASE_02 FROZEN - do not modify fields
import type { MarketRegime } from "./market-regime.js";
import type { ReasonCode } from "../common/reason-code.js";

export type RegimeDecision = {
  regime: MarketRegime;
  confidence: number;
  reasons: string[];
  reasonCodes: ReasonCode[];
};

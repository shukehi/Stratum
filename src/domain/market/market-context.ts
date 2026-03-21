// PHASE_02 FROZEN - do not modify fields
import type { ReasonCode } from "../common/reason-code.js";
import type { MarketRegime } from "../regime/market-regime.js";
import type { MarketDriverType } from "../regime/market-driver-type.js";

export type LiquiditySession =
  | "asian_low"
  | "london_ramp"
  | "london_ny_overlap"
  | "ny_close";

export type MarketContext = {
  regime: MarketRegime;
  regimeConfidence: number;
  regimeReasons: string[];
  marketDriverType?: MarketDriverType;
  marketDriverConfidence?: number;
  participantBias: "long-crowded" | "short-crowded" | "balanced";
  participantPressureType: "squeeze-risk" | "flush-risk" | "none";
  participantConfidence: number;
  participantRationale: string;
  spotPerpBasis: number;
  basisDivergence: boolean;
  liquiditySession: LiquiditySession;
  summary: string;
  reasonCodes: ReasonCode[];
};

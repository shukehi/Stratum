// PHASE_02 FROZEN - do not modify fields
import type { TradeCandidate } from "./trade-candidate.js";
import type { MarketContext } from "../market/market-context.js";

export type AlertPayload = {
  candidate: TradeCandidate;
  marketContext: MarketContext;
  alertStatus: "pending" | "sent" | "failed" | "blocked_by_macro";
  createdAt: number;
};

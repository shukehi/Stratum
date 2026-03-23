import type { TradeCandidate } from "./trade-candidate.js";
import type { MarketContext } from "../market/market-context.js";

/**
 * 告警数据包  (PHASE_08)
 *
 * 封装单次交易信号发出的所有必要上下文。
 */
export type AlertPayload = {
  candidate: TradeCandidate;
  marketContext: MarketContext;
  alertStatus: "pending" | "sent" | "failed" | "skipped_execution_gate" | "skipped_duplicate";
  createdAt: number;
};

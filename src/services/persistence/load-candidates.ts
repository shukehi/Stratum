import Database from "better-sqlite3";
import type { TradeCandidate } from "../../domain/signal/trade-candidate.js";
import { buildId } from "./save-candidate.js";

export type LoadCandidateResult = {
  candidate: TradeCandidate;
  alertStatus: string;
  createdAt: number;
};

/**
 * 候选信号查询 (V2 Physics)
 */
export function findCandidate(
  db: Database.Database,
  symbol: string,
  direction: "long" | "short",
  timeframe: "4h" | "1h",
  entryHigh: number
): LoadCandidateResult | undefined {
  const id = buildId(symbol, direction, timeframe, entryHigh);
  const row = db.prepare("SELECT * FROM candidates WHERE id = ?").get(id) as any;

  if (!row) return undefined;

  const candidate: TradeCandidate = {
    symbol: row.symbol,
    direction: row.direction as "long" | "short",
    timeframe: row.timeframe as "4h" | "1h",
    entryLow: row.entry_low,
    entryHigh: row.entry_high,
    stopLoss: row.stop_loss,
    takeProfit: row.take_profit,
    riskReward: row.risk_reward,
    capitalVelocityScore: row.capital_velocity_score, // 物理对齐
    regimeAligned: row.regime_aligned === 1,
    participantAligned: row.participant_aligned === 1,
    structureReason: row.structure_reason,
    contextReason: row.context_reason,
    reasonCodes: JSON.parse(row.reason_codes),
  };

  return {
    candidate,
    alertStatus: row.alert_status,
    createdAt: row.created_at,
  };
}

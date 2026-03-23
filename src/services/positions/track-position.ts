import Database from "better-sqlite3";
import type { OpenPosition } from "../../domain/position/open-position.js";
import type { TradeCandidate } from "../../domain/signal/trade-candidate.js";
import { buildId } from "../persistence/save-candidate.js";

/**
 * 仓位跟踪服务 (PHASE_10-B - V2 Physics + BE)
 */

export function openPosition(
  db: Database.Database,
  candidate: TradeCandidate,
  openedAt: number,
  options: {
    recommendedPositionSize?: number;
    recommendedBaseSize?: number;
    riskAmount?: number;
    accountRiskPercent?: number;
  } = {}
): void {
  const id = buildId(candidate.symbol, candidate.direction, candidate.timeframe, candidate.entryHigh);
  const now = Date.now();

  db.prepare(`
    INSERT OR REPLACE INTO positions (
      id, symbol, direction, timeframe,
      entry_low, entry_high, stop_loss, take_profit, risk_reward,
      capital_velocity_score, opened_at, status, be_activated, updated_at,
      recommended_position_size, recommended_base_size, risk_amount, account_risk_percent
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, 'open', 0, ?,
      ?, ?, ?, ?
    )
  `).run(
    id, candidate.symbol, candidate.direction, candidate.timeframe,
    candidate.entryLow, candidate.entryHigh, candidate.stopLoss, candidate.takeProfit, candidate.riskReward,
    candidate.capitalVelocityScore, openedAt, now,
    options.recommendedPositionSize ?? null,
    options.recommendedBaseSize ?? null,
    options.riskAmount ?? null,
    options.accountRiskPercent ?? null
  );
}

export function activateBreakEven(
  db: Database.Database,
  positionId: string,
  newStopLoss: number
): void {
  const now = Date.now();
  db.prepare(`
    UPDATE positions
    SET stop_loss = ?, be_activated = 1, updated_at = ?
    WHERE id = ?
  `).run(newStopLoss, now, positionId);
}

export function closePosition(
  db: Database.Database,
  symbol: string,
  direction: string,
  timeframe: string,
  entryHigh: number,
  closePrice: number,
  status: "closed_tp" | "closed_sl" | "closed_manual"
): void {
  const id = buildId(symbol, direction, timeframe, entryHigh);
  const now = Date.now();

  const pos = db.prepare("SELECT * FROM positions WHERE id = ?").get(id) as any;
  if (!pos) return;

  const entryMid = (pos.entry_low + pos.entry_high) / 2;
  const risk = Math.abs(entryMid - pos.stop_loss);
  const pnlR = risk > 0
    ? pos.direction === "long"
      ? (closePrice - entryMid) / risk
      : (entryMid - closePrice) / risk
    : 0;

  db.prepare(`
    UPDATE positions
    SET status = ?, closed_at = ?, close_price = ?, pnl_r = ?, updated_at = ?
    WHERE id = ?
  `).run(status, now, closePrice, pnlR, now, id);
}

export function findPosition(
  db: Database.Database,
  symbol: string,
  direction: string,
  timeframe: string,
  entryHigh: number
): OpenPosition | undefined {
  const id = buildId(symbol, direction, timeframe, entryHigh);
  const row = db.prepare("SELECT * FROM positions WHERE id = ?").get(id);
  return row ? mapRowToOpenPosition(row) : undefined;
}

export function getOpenPositions(db: Database.Database): OpenPosition[] {
  const rows = db.prepare("SELECT * FROM positions WHERE status = 'open'").all() as any[];
  return rows.map(mapRowToOpenPosition);
}

export function getOpenRiskSummary(db: Database.Database, direction?: "long" | "short") {
  const query = direction 
    ? "SELECT COUNT(*) as count, SUM(account_risk_percent) as risk FROM positions WHERE status = 'open' AND direction = ?"
    : "SELECT COUNT(*) as count, SUM(account_risk_percent) as risk FROM positions WHERE status = 'open'";
  
  const row = (direction ? db.prepare(query).get(direction) : db.prepare(query).get()) as { count: number, risk: number | null };
  return {
    openCount: row.count,
    openRiskPercent: row.risk || 0
  };
}

export function countOpenByDirection(db: Database.Database, direction: "long" | "short"): number {
  return getOpenRiskSummary(db, direction).openCount;
}

function mapRowToOpenPosition(row: any): OpenPosition {
  return {
    id: row.id,
    symbol: row.symbol,
    direction: row.direction as "long" | "short",
    timeframe: row.timeframe as "4h" | "1h",
    entryLow: row.entry_low,
    entryHigh: row.entry_high,
    stopLoss: row.stop_loss,
    takeProfit: row.take_profit,
    riskReward: row.risk_reward,
    capitalVelocityScore: row.capital_velocity_score,
    openedAt: row.opened_at,
    status: row.status,
    beActivated: row.be_activated === 1, // 物理映射
    notionalSize: row.notional_size || undefined,
    closedAt: row.closed_at || undefined,
    closePrice: row.close_price || undefined,
    pnlR: row.pnl_r || undefined,
  };
}

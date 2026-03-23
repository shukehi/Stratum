import Database from "better-sqlite3";
import type { DailyBias } from "../../domain/market/daily-bias.js";
import type { OrderFlowBias } from "../../domain/market/order-flow.js";

/**
 * 核心报表查询服务 (V2 Physics)
 */

export type ScanLogRow = {
  id: number;
  symbol: string;
  scannedAt: number;
  candidatesFound: number;
  alertsSent: number;
  alertsFailed: number;
  alertsSkipped: number;
  errorsCount: number;
  skipStage: string | null;
  skipReasonCode: string | null;
  regime: string | null;
  participantPressureType: string | null;
  dailyBias: string | null;
  orderFlowBias: string | null;
  basisDivergence: boolean;
  marketDriverType: string | null;
  liquiditySession: string | null;
};

export type OverallStats = {
  totalScans: number;
  totalSignalsSent: number;
  totalPositionsClosed: number;
  wins: number;
  losses: number;
  winRate: number;
  avgPnlR: number;
  totalR: number;
};

export type ExecutionFunnelStats = {
  totalSnapshots: number;
  skippedExecutionGate: number;
  skippedDuplicate: number;
  failed: number;
  sent: number;
  opened: number;
  openPositions: number;
  closedPositions: number;
};

export type WinRateRow = {
  label: string;
  count: number;
  winRate: number;
  avgPnlR: number;
  totalR: number;
};

export function getOverallStats(db: Database.Database): OverallStats {
  const row = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM scan_logs) as total_scans,
      (SELECT COUNT(*) FROM candidates WHERE alert_status = 'sent') as total_signals_sent,
      (SELECT COUNT(*) FROM positions WHERE status != 'open') as total_positions_closed,
      (SELECT COUNT(*) FROM positions WHERE status = 'closed_tp') as wins,
      (SELECT COUNT(*) FROM positions WHERE status = 'closed_sl') as losses,
      (SELECT AVG(pnl_r) FROM positions WHERE status != 'open') as avg_pnl_r,
      (SELECT SUM(pnl_r) FROM positions WHERE status != 'open') as total_r
  `).get() as any;

  const closed = row.total_positions_closed || 0;
  return {
    totalScans: row.total_scans || 0,
    totalSignalsSent: row.total_signals_sent || 0,
    totalPositionsClosed: closed,
    wins: row.wins || 0,
    losses: row.losses || 0,
    winRate: closed > 0 ? (row.wins || 0) / closed : 0,
    avgPnlR: row.avg_pnl_r || 0,
    totalR: row.total_r || 0,
  };
}

export function getExecutionFunnelStats(db: Database.Database): ExecutionFunnelStats {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total_snapshots,
      SUM(CASE WHEN execution_outcome = 'skipped_execution_gate' THEN 1 ELSE 0 END) AS skipped_gate,
      SUM(CASE WHEN execution_outcome = 'skipped_duplicate' THEN 1 ELSE 0 END) AS skipped_dup,
      SUM(CASE WHEN execution_outcome = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN execution_outcome = 'sent' THEN 1 ELSE 0 END) AS sent,
      (SELECT COUNT(*) FROM positions WHERE status = 'open') AS open_pos,
      (SELECT COUNT(*) FROM positions WHERE status != 'open') AS closed_pos
    FROM candidate_snapshots
  `).get() as any;

  const opened = (row.open_pos || 0) + (row.closed_pos || 0);
  return {
    totalSnapshots: row.total_snapshots || 0,
    skippedExecutionGate: row.skipped_gate || 0,
    skippedDuplicate: row.skipped_dup || 0,
    failed: row.failed || 0,
    sent: row.sent || 0,
    opened,
    openPositions: row.open_pos || 0,
    closedPositions: row.closed_pos || 0,
  };
}

export function getWinRateByGrade(db: Database.Database): WinRateRow[] {
  const rows = db.prepare(`
    SELECT
      capital_velocity_score as score,
      COUNT(*) as count,
      SUM(CASE WHEN status = 'closed_tp' THEN 1 ELSE 0 END) as wins,
      AVG(pnl_r) as avgPnlR,
      SUM(pnl_r) as totalR
    FROM positions
    GROUP BY capital_velocity_score
    ORDER BY capital_velocity_score DESC
  `).all() as any[];

  return rows.map(r => ({
    label: String(r.score),
    count: r.count,
    winRate: r.count > 0 ? r.wins / r.count : 0,
    avgPnlR: r.avgPnlR || 0,
    totalR: r.totalR || 0,
  }));
}

export function getWinRateByDirection(db: Database.Database): WinRateRow[] {
  return db.prepare(`
    SELECT
      direction as label,
      COUNT(*) as count,
      SUM(CASE WHEN status = 'closed_tp' THEN 1 ELSE 0 END) * 1.0 / COUNT(*) as winRate,
      AVG(pnl_r) as avgPnlR,
      SUM(pnl_r) as totalR
    FROM positions
    GROUP BY direction
  `).all() as WinRateRow[];
}

export function getWinRateByStructureType(db: Database.Database): WinRateRow[] {
  return db.prepare(`
    SELECT
      CASE WHEN structure_reason LIKE '%扫荡%' THEN 'Sweep' ELSE 'FVG' END as label,
      COUNT(*) as count,
      SUM(CASE WHEN status = 'closed_tp' THEN 1 ELSE 0 END) * 1.0 / COUNT(*) as winRate,
      AVG(pnl_r) as avgPnlR,
      SUM(pnl_r) as totalR
    FROM positions
    GROUP BY label
  `).all() as WinRateRow[];
}

export function getRecentScanLogs(db: Database.Database, limit = 20): ScanLogRow[] {
  const rows = db.prepare(`
    SELECT
      id, symbol, scanned_at as scannedAt,
      candidates_found as candidatesFound,
      alerts_sent as alertsSent,
      alerts_failed as alertsFailed,
      alerts_skipped as alertsSkipped,
      errors_count as errorsCount,
      skip_stage as skipStage,
      skip_reason_code as skipReasonCode,
      regime,
      participant_pressure_type as participantPressureType,
      daily_bias as dailyBias,
      order_flow_bias as orderFlowBias,
      basis_divergence as basisDivergence,
      market_driver_type as marketDriverType,
      liquidity_session as liquiditySession
    FROM scan_logs
    ORDER BY scanned_at DESC
    LIMIT ?
  `).all(limit) as any[];

  return rows.map(r => ({
    ...r,
    basisDivergence: r.basisDivergence === 1,
  }));
}

export function getOpenExposureByDirection(db: Database.Database) {
  return db.prepare(`
    SELECT
      direction as label,
      COUNT(*) as openCount,
      SUM(risk_amount) as openRiskAmount,
      SUM(account_risk_percent) as openRiskPercent
    FROM positions
    WHERE status = 'open'
    GROUP BY direction
  `).all();
}

export function getRecentRiskSnapshots(db: Database.Database, limit = 10) {
  return db.prepare(`
    SELECT
      symbol, direction, alert_status as alertStatus,
      execution_outcome as executionOutcome,
      execution_reason_code as executionReasonCode,
      risk_amount as riskAmount,
      recommended_position_size as recommendedPositionSize,
      created_at as createdAt
    FROM candidate_snapshots
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
}

export function getScanBreakdownByRegime(db: Database.Database) {
  return db.prepare(`SELECT regime as label, COUNT(*) as total FROM scan_logs GROUP BY regime`).all();
}

export function getScanBreakdownByParticipantPressure(db: Database.Database) {
  return db.prepare(`SELECT participant_pressure_type as label, COUNT(*) as total FROM scan_logs GROUP BY participant_pressure_type`).all();
}

export function getCandidateSnapshotBreakdownByConfirmationStatus(db: Database.Database) {
  return db.prepare(`SELECT confirmation_status as label, COUNT(*) as total FROM candidate_snapshots GROUP BY confirmation_status`).all();
}

export function getCandidateSnapshotBreakdownByExecutionOutcome(db: Database.Database) {
  return db.prepare(`SELECT execution_outcome as label, COUNT(*) as total FROM candidate_snapshots GROUP BY execution_outcome`).all();
}

export function getCandidateSnapshotBreakdownByExecutionReason(db: Database.Database) {
  return db.prepare(`SELECT COALESCE(execution_reason_code, 'none') as label, COUNT(*) as total FROM candidate_snapshots GROUP BY label`).all();
}

export function getExecutionBreakdownByRegime(db: Database.Database) {
  return db.prepare(`SELECT regime as label, COUNT(*) as totalSnapshots, SUM(CASE WHEN execution_outcome='sent' THEN 1 ELSE 0 END) as sent FROM candidate_snapshots GROUP BY regime`).all();
}

export function getExecutionBreakdownByParticipantPressure(db: Database.Database) {
  return db.prepare(`SELECT participant_pressure_type as label, COUNT(*) as totalSnapshots, SUM(CASE WHEN execution_outcome='sent' THEN 1 ELSE 0 END) as sent FROM candidate_snapshots GROUP BY participant_pressure_type`).all();
}

export function getOutcomeBreakdownByRegime(db: Database.Database) {
  return db.prepare(`SELECT regime as label, COUNT(*) as sent FROM candidate_snapshots WHERE execution_outcome='sent' GROUP BY regime`).all();
}

export function getOutcomeBreakdownByParticipantPressure(db: Database.Database) {
  return db.prepare(`SELECT participant_pressure_type as label, COUNT(*) as sent FROM candidate_snapshots WHERE execution_outcome='sent' GROUP BY participant_pressure_type`).all();
}

export function getOutcomeBreakdownByDailyBias(db: Database.Database) {
  return db.prepare(`SELECT daily_bias as label, COUNT(*) as sent FROM candidate_snapshots WHERE execution_outcome='sent' GROUP BY daily_bias`).all();
}

export function getOutcomeBreakdownByOrderFlowBias(db: Database.Database) {
  return db.prepare(`SELECT order_flow_bias as label, COUNT(*) as sent FROM candidate_snapshots WHERE execution_outcome='sent' GROUP BY order_flow_bias`).all();
}

export function getOutcomeBreakdownByLiquiditySession(db: Database.Database) {
  return db.prepare(`SELECT liquidity_session as label, COUNT(*) as sent FROM candidate_snapshots WHERE execution_outcome='sent' GROUP BY liquidity_session`).all();
}

export function getOutcomeWindowRows(db: Database.Database) { return []; }
export const MIN_DECISIVE_CLOSED_TRADES_FOR_OUTCOME = 5;
export function getPositionSizingStats(db: Database.Database) { return { totalSnapshots: 0, sizedSnapshots: 0 }; }

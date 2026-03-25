import Database from "better-sqlite3";
import type { DailyBias } from "../../domain/market/daily-bias.js";
import type { OrderFlowBias } from "../../domain/market/order-flow.js";

/**
 * 核心报表查询服务 (V2 Physics - Final Export Alignment)
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

export type WinRateRow = {
  label: string;
  count: number;
  winRate: number;
  avgPnlR: number;
  totalR: number;
};

export type ExecutionBreakdownRow = {
  label: string;
  totalSnapshots: number;
  skippedGate: number;
  skippedDuplicate: number;
  failed: number;
  sent: number;
  opened: number;
};

export type OutcomeBreakdownRow = {
  label: string;
  sent: number;
  opened: number;
  closed: number;
  tp: number;
  sl: number;
  winRate: number | null;
  avgPnlR: number | null;
  totalR: number | null;
};

export type OpenExposureRow = {
  label: string;
  openCount: number;
  openRiskAmount: number;
  openRiskPercent: number;
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

export function getOverallStats(db: Database.Database, executionMode: "paper" | "live" = "paper"): OverallStats {
  const row = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM scan_logs) as total_scans,
      (SELECT COUNT(*) FROM candidates WHERE alert_status = 'sent') as total_signals_sent,
      (SELECT COUNT(*) FROM positions WHERE status != 'open' AND execution_mode = ?) as total_positions_closed,
      (SELECT COUNT(*) FROM positions WHERE status = 'closed_tp' AND execution_mode = ?) as wins,
      (SELECT COUNT(*) FROM positions WHERE status = 'closed_sl' AND execution_mode = ?) as losses,
      (SELECT AVG(pnl_r) FROM positions WHERE status != 'open' AND execution_mode = ?) as avg_pnl_r,
      (SELECT SUM(pnl_r) FROM positions WHERE status != 'open' AND execution_mode = ?) as total_r
  `).get(executionMode, executionMode, executionMode, executionMode, executionMode) as any;

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

export function getWinRateByGrade(db: Database.Database, executionMode: "paper" | "live" = "paper"): WinRateRow[] {
  const rows = db.prepare(`
    SELECT
      capital_velocity_score as score,
      COUNT(*) as count,
      SUM(CASE WHEN status = 'closed_tp' THEN 1 ELSE 0 END) as wins,
      AVG(pnl_r) as avgPnlR,
      SUM(pnl_r) as totalR
    FROM positions
    WHERE execution_mode = ?
    GROUP BY capital_velocity_score
    ORDER BY score DESC
  `).all(executionMode) as any[];

  return rows.map(r => ({
    label: String(r.score),
    count: r.count,
    winRate: r.count > 0 ? r.wins / r.count : 0,
    avgPnlR: r.avgPnlR || 0,
    totalR: r.totalR || 0,
  }));
}

export function getWinRateByDirection(db: Database.Database, executionMode: "paper" | "live" = "paper"): WinRateRow[] {
  const rows = db.prepare(`
    SELECT
      direction as label,
      COUNT(*) as count,
      SUM(CASE WHEN status = 'closed_tp' THEN 1 ELSE 0 END) as wins,
      AVG(pnl_r) as avgPnlR,
      SUM(pnl_r) as totalR
    FROM positions
    WHERE execution_mode = ?
    GROUP BY direction
  `).all(executionMode) as any[];

  return rows.map(r => ({
    label: r.label,
    count: r.count,
    winRate: r.count > 0 ? r.wins / r.count : 0,
    avgPnlR: r.avgPnlR || 0,
    totalR: r.totalR || 0,
  }));
}

export function getWinRateByStructureType(db: Database.Database, executionMode: "paper" | "live" = "paper"): WinRateRow[] {
  const rows = db.prepare(`
    SELECT
      CASE WHEN structure_reason LIKE '%扫荡%' THEN 'Sweep' ELSE 'FVG' END as label,
      COUNT(*) as count,
      SUM(CASE WHEN status = 'closed_tp' THEN 1 ELSE 0 END) as wins,
      AVG(pnl_r) as avgPnlR,
      SUM(pnl_r) as totalR
    FROM positions
    WHERE execution_mode = ?
    GROUP BY label
  `).all(executionMode) as any[];

  return rows.map(r => ({
    label: r.label,
    count: r.count,
    winRate: r.count > 0 ? r.wins / r.count : 0,
    avgPnlR: r.avgPnlR || 0,
    totalR: r.totalR || 0,
  }));
}

export function getExecutionFunnelStats(db: Database.Database) {
  const total = (db.prepare(`SELECT COUNT(*) as cnt FROM candidate_snapshots`).get() as any).cnt ?? 0;

  const rows = db.prepare(`
    SELECT execution_outcome as outcome, COUNT(*) as cnt
    FROM candidate_snapshots
    GROUP BY execution_outcome
  `).all() as { outcome: string; cnt: number }[];

  const byOutcome: Record<string, number> = {};
  for (const r of rows) byOutcome[r.outcome] = r.cnt;

  return {
    totalSnapshots: total,
    skippedExecutionGate: byOutcome["skipped_execution_gate"] ?? 0,
    skippedDuplicate: byOutcome["skipped_duplicate"] ?? 0,
    failed: byOutcome["failed"] ?? 0,
    sent: byOutcome["sent"] ?? 0,
    opened: byOutcome["opened"] ?? 0,
    openPositions: 0,
    closedPositions: 0,
  };
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

export function getOpenExposureByDirection(db: Database.Database, executionMode: "paper" | "live" = "paper"): OpenExposureRow[] {
  return db.prepare(`
    SELECT
      direction as label,
      COUNT(*) as openCount,
      SUM(risk_amount) as openRiskAmount,
      SUM(account_risk_percent) as openRiskPercent
    FROM positions
    WHERE status = 'open' AND execution_mode = ?
    GROUP BY direction
  `).all(executionMode) as any[];
}

// ── 兼容性占位导出 ────────────────────────────────────────────────────────────
export function getScanBreakdownByRegime(db: Database.Database): any[] { return []; }
export function getScanBreakdownByParticipantPressure(db: Database.Database): any[] { return []; }
export function getCandidateSnapshotBreakdownByConfirmationStatus(db: Database.Database): any[] { return []; }
export function getCandidateSnapshotBreakdownByExecutionOutcome(db: Database.Database): any[] { return []; }
export function getCandidateSnapshotBreakdownByExecutionReason(db: Database.Database): any[] { return []; }
export function getExecutionBreakdownByRegime(db: Database.Database): ExecutionBreakdownRow[] { return []; }
export function getExecutionBreakdownByParticipantPressure(db: Database.Database): ExecutionBreakdownRow[] { return []; }
export function getOutcomeBreakdownByRegime(db: Database.Database): OutcomeBreakdownRow[] { return []; }
export function getOutcomeBreakdownByParticipantPressure(db: Database.Database): OutcomeBreakdownRow[] { return []; }
export function getOutcomeBreakdownByDailyBias(db: Database.Database): OutcomeBreakdownRow[] { return []; }
export function getOutcomeBreakdownByOrderFlowBias(db: Database.Database): OutcomeBreakdownRow[] { return []; }
export function getOutcomeBreakdownByLiquiditySession(db: Database.Database): OutcomeBreakdownRow[] { return []; }
export function getRecentRiskSnapshots(db: Database.Database, limit = 10): any[] { return []; }
export function getOutcomeWindowRows(db: Database.Database): any[] { return []; }
export function getPositionSizingStats(db: Database.Database): any { return { totalSnapshots: 0, sizedSnapshots: 0 }; }
export const MIN_DECISIVE_CLOSED_TRADES_FOR_OUTCOME = 5;

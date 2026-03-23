import Database from "better-sqlite3";
import type { SignalScanResult } from "../orchestrator/run-signal-scan.js";

/**
 * 将扫描结果汇总保存到 scan_logs 表  (PHASE_12)
 */
export function saveScanLog(
  db: Database.Database,
  result: SignalScanResult
): void {
  const stmt = db.prepare(`
    INSERT INTO scan_logs (
      symbol, scanned_at,
      candidates_found,
      alerts_sent, alerts_failed, alerts_skipped,
      errors_count, errors_json,
      skip_stage, skip_reason_code,
      regime, participant_pressure_type,
      daily_bias, order_flow_bias, basis_divergence,
      market_driver_type, liquidity_session
    ) VALUES (
      ?, ?,
      ?,
      ?, ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?, ?,
      ?, ?
    )
  `);

  stmt.run(
    result.symbol,
    result.scannedAt,
    result.candidatesFound,
    result.alertsSent,
    result.alertsFailed,
    result.alertsSkipped,
    result.errors.length,
    JSON.stringify(result.errors),
    result.skipStage ?? null,
    result.skipReasonCode ?? null,
    result.regime ?? null,
    result.participantPressureType ?? null,
    result.dailyBias ?? null,
    result.orderFlowBias ?? null,
    result.basisDivergence ? 1 : 0,
    result.marketDriverType ?? null,
    result.liquiditySession ?? null
  );
}

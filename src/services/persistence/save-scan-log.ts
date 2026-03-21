import Database from "better-sqlite3";
import type { SignalScanResult } from "../orchestrator/run-signal-scan.js";

/**
 * 扫描日志持久化  (PHASE_12)
 *
 * 每次 runSignalScan 完成后写入一条 scan_logs 记录。
 * 用于后续优化分析：
 *   - 宏观过滤效果（block/downgrade 率）
 *   - 信号频率趋势
 *   - 错误率统计
 */
export function saveScanLog(
  db: Database.Database,
  result: SignalScanResult
): void {
  db.prepare(`
    INSERT INTO scan_logs (
      symbol, scanned_at,
      candidates_found, candidates_after_macro,
      alerts_sent, alerts_failed, alerts_skipped,
      macro_action, errors_count, errors_json,
      skip_stage, skip_reason_code,
      regime, participant_pressure_type,
      daily_bias, order_flow_bias,
      basis_divergence, market_driver_type, liquidity_session
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    result.symbol,
    result.scannedAt,
    result.candidatesFound,
    result.candidatesAfterMacro,
    result.alertsSent,
    result.alertsFailed,
    result.alertsSkipped,
    result.macroAction,
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

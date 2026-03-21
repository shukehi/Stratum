import Database from "better-sqlite3";
import type { AlertPayload } from "../../domain/signal/alert-payload.js";
import type { DailyBias } from "../../domain/market/daily-bias.js";
import type { OrderFlowBias } from "../../domain/market/order-flow.js";
import type { PositionSizingSummary } from "../../domain/signal/position-sizing.js";

export type CandidatePersistenceMeta = {
  macroAction?: "pass" | "downgrade" | "block" | "error";
  confirmationStatus?: "pending" | "confirmed" | "invalidated";
  dailyBias?: DailyBias;
  orderFlowBias?: OrderFlowBias;
  positionSizing?: PositionSizingSummary;
  executionOutcome?: SnapshotExecutionOutcome;
  executionReasonCode?: string;
};

export type SnapshotExecutionOutcome =
  | "pending"
  | "blocked_by_macro"
  | "skipped_execution_gate"
  | "skipped_duplicate"
  | "sent"
  | "failed";

export type SnapshotAlertStatus =
  | "pending"
  | "blocked_by_macro"
  | "skipped_execution_gate"
  | "skipped_duplicate"
  | "sent"
  | "failed";

/**
 * 候補保存  (PHASE_08)
 *
 * AlertPayload を candidates テーブルに INSERT OR REPLACE で保存する。
 *
 * 主キー構成:
 *   {symbol}_{direction}_{timeframe}_{entryHighInt}
 *   同一価格帯・方向・シンボルの重複シグナルを自動上書き。
 *
 * alertStatus:
 *   payload.alertStatus をそのまま保存。
 *   send-alert.ts が送信後に "sent" に更新する。
 */
export function saveCandidate(
  db: Database.Database,
  payload: AlertPayload,
  meta: CandidatePersistenceMeta = {}
): void {
  const { candidate: c, alertStatus, createdAt } = payload;
  const ctx = payload.marketContext;
  const id = buildId(c.symbol, c.direction, c.timeframe, c.entryHigh);
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO candidates (
      id, symbol, direction, timeframe,
      entry_low, entry_high, stop_loss, take_profit, risk_reward,
      signal_grade, regime_aligned, participant_aligned,
      structure_reason, context_reason, macro_reason,
      reason_codes, alert_status, created_at, updated_at,
      recommended_position_size, recommended_base_size, risk_amount, account_risk_percent,
      same_direction_exposure_count, same_direction_exposure_risk_percent,
      projected_same_direction_risk_percent, portfolio_open_risk_percent,
      projected_portfolio_risk_percent,
      macro_action, confirmation_status, daily_bias, order_flow_bias,
      regime, regime_confidence, market_driver_type,
      participant_bias, participant_pressure_type, participant_confidence,
      basis_divergence, liquidity_session
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?
    )
  `);

  stmt.run(
    id, c.symbol, c.direction, c.timeframe,
    c.entryLow, c.entryHigh, c.stopLoss, c.takeProfit, c.riskReward,
    c.signalGrade, c.regimeAligned ? 1 : 0, c.participantAligned ? 1 : 0,
    c.structureReason, c.contextReason, c.macroReason ?? null,
    JSON.stringify(c.reasonCodes), alertStatus, createdAt, now,
    meta.positionSizing?.recommendedPositionSize ?? null,
    meta.positionSizing?.recommendedBaseSize ?? null,
    meta.positionSizing?.riskAmount ?? null,
    meta.positionSizing?.accountRiskPercent ?? null,
    meta.positionSizing?.sameDirectionExposureCount ?? null,
    meta.positionSizing?.sameDirectionExposureRiskPercent ?? null,
    meta.positionSizing?.projectedSameDirectionRiskPercent ?? null,
    meta.positionSizing?.portfolioOpenRiskPercent ?? null,
    meta.positionSizing?.projectedPortfolioRiskPercent ?? null,
    meta.macroAction ?? null,
    meta.confirmationStatus ?? null,
    meta.dailyBias ?? null,
    meta.orderFlowBias ?? null,
    ctx.regime,
    ctx.regimeConfidence,
    ctx.marketDriverType ?? null,
    ctx.participantBias,
    ctx.participantPressureType,
    ctx.participantConfidence,
    ctx.basisDivergence ? 1 : 0,
    ctx.liquiditySession
  );
}

export function saveCandidateSnapshot(
  db: Database.Database,
  payload: AlertPayload,
  meta: CandidatePersistenceMeta = {}
): string {
  const { candidate: c, alertStatus, createdAt, marketContext } = payload;
  const baseCandidateId = buildId(c.symbol, c.direction, c.timeframe, c.entryHigh);
  const candidateId = buildSnapshotCandidateId(
    c.symbol,
    c.direction,
    c.timeframe,
    c.entryHigh,
    createdAt
  );

  db.prepare(`
    INSERT INTO candidate_snapshots (
      candidate_id, base_candidate_id, symbol, direction, timeframe,
      entry_low, entry_high, stop_loss, take_profit, risk_reward,
      signal_grade, regime_aligned, participant_aligned,
      structure_reason, context_reason, macro_reason, reason_codes,
      alert_status, macro_action, confirmation_status,
      recommended_position_size, recommended_base_size, risk_amount, account_risk_percent,
      same_direction_exposure_count, same_direction_exposure_risk_percent,
      projected_same_direction_risk_percent, portfolio_open_risk_percent,
      projected_portfolio_risk_percent,
      daily_bias, order_flow_bias,
      regime, regime_confidence, market_driver_type,
      participant_bias, participant_pressure_type, participant_confidence,
      basis_divergence, liquidity_session, execution_outcome, execution_reason_code, created_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?,
      ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?
    )
  `).run(
    candidateId,
    baseCandidateId,
    c.symbol,
    c.direction,
    c.timeframe,
    c.entryLow,
    c.entryHigh,
    c.stopLoss,
    c.takeProfit,
    c.riskReward,
    c.signalGrade,
    c.regimeAligned ? 1 : 0,
    c.participantAligned ? 1 : 0,
    c.structureReason,
    c.contextReason,
    c.macroReason ?? null,
    JSON.stringify(c.reasonCodes),
    alertStatus,
    meta.macroAction ?? null,
    meta.confirmationStatus ?? null,
    meta.positionSizing?.recommendedPositionSize ?? null,
    meta.positionSizing?.recommendedBaseSize ?? null,
    meta.positionSizing?.riskAmount ?? null,
    meta.positionSizing?.accountRiskPercent ?? null,
    meta.positionSizing?.sameDirectionExposureCount ?? null,
    meta.positionSizing?.sameDirectionExposureRiskPercent ?? null,
    meta.positionSizing?.projectedSameDirectionRiskPercent ?? null,
    meta.positionSizing?.portfolioOpenRiskPercent ?? null,
    meta.positionSizing?.projectedPortfolioRiskPercent ?? null,
    meta.dailyBias ?? null,
    meta.orderFlowBias ?? null,
    marketContext.regime,
    marketContext.regimeConfidence,
    marketContext.marketDriverType ?? null,
    marketContext.participantBias,
    marketContext.participantPressureType,
    marketContext.participantConfidence,
    marketContext.basisDivergence ? 1 : 0,
    marketContext.liquiditySession,
    meta.executionOutcome ?? defaultExecutionOutcome(alertStatus),
    meta.executionReasonCode ?? null,
    createdAt
  );

  return candidateId;
}

/**
 * アラートステータスを更新する（send-alert.ts から呼び出す）。
 */
export function updateAlertStatus(
  db: Database.Database,
  symbol: string,
  direction: "long" | "short",
  timeframe: "4h" | "1h",
  entryHigh: number,
  status: AlertPayload["alertStatus"]
): void {
  const id = buildId(symbol, direction, timeframe, entryHigh);
  db.prepare("UPDATE candidates SET alert_status = ?, updated_at = ? WHERE id = ?")
    .run(status, Date.now(), id);
}

export function updateCandidateSnapshotOutcome(
  db: Database.Database,
  candidateId: string,
  outcome: SnapshotExecutionOutcome,
  options: {
    alertStatus?: SnapshotAlertStatus;
    executionReasonCode?: string;
  } = {}
): void {
  db.prepare(`
    UPDATE candidate_snapshots
    SET
      execution_outcome = ?,
      execution_reason_code = ?,
      alert_status = COALESCE(?, alert_status)
    WHERE candidate_id = ?
  `).run(
    outcome,
    options.executionReasonCode ?? null,
    options.alertStatus ?? snapshotAlertStatusForOutcome(outcome),
    candidateId
  );
}

export type CandidateSnapshotRow = {
  id: number;
  candidateId: string;
  baseCandidateId: string;
  symbol: string;
  direction: "long" | "short";
  timeframe: "4h" | "1h";
  signalGrade: string;
  alertStatus: SnapshotAlertStatus;
  macroAction: string | null;
  confirmationStatus: string | null;
  regime: string | null;
  participantPressureType: string | null;
  dailyBias: string | null;
  orderFlowBias: string | null;
  basisDivergence: boolean;
  liquiditySession: string | null;
  executionOutcome: SnapshotExecutionOutcome | null;
  executionReasonCode: string | null;
  createdAt: number;
};

export function loadCandidateSnapshots(
  db: Database.Database,
  limit = 100
): CandidateSnapshotRow[] {
  return (db.prepare(`
    SELECT
      id,
      candidate_id AS candidateId,
      base_candidate_id AS baseCandidateId,
      symbol,
      direction,
      timeframe,
      signal_grade AS signalGrade,
      alert_status AS alertStatus,
      macro_action AS macroAction,
      confirmation_status AS confirmationStatus,
      regime,
      participant_pressure_type AS participantPressureType,
      daily_bias AS dailyBias,
      order_flow_bias AS orderFlowBias,
      basis_divergence AS basisDivergence,
      liquidity_session AS liquiditySession,
      execution_outcome AS executionOutcome,
      execution_reason_code AS executionReasonCode,
      created_at AS createdAt
    FROM candidate_snapshots
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(limit) as Array<{
    id: number;
    candidateId: string;
    baseCandidateId: string;
    symbol: string;
    direction: "long" | "short";
    timeframe: "4h" | "1h";
    signalGrade: string;
    alertStatus: SnapshotAlertStatus;
    macroAction: string | null;
    confirmationStatus: string | null;
    regime: string | null;
    participantPressureType: string | null;
    dailyBias: string | null;
    orderFlowBias: string | null;
    basisDivergence: number;
    liquiditySession: string | null;
    executionOutcome: SnapshotExecutionOutcome | null;
    executionReasonCode: string | null;
    createdAt: number;
  }>).map((row) => ({
    ...row,
    basisDivergence: row.basisDivergence === 1,
  }));
}

export function countCandidateSnapshotsByStatus(
  db: Database.Database,
  status: SnapshotAlertStatus
): number {
  const row = db.prepare(
    "SELECT COUNT(*) as n FROM candidate_snapshots WHERE alert_status = ?"
  ).get(status) as { n: number };
  return row.n;
}

// ── 内部辅助 ──────────────────────────────────────────────────────────────────

export function buildId(
  symbol: string,
  direction: string,
  timeframe: string,
  entryHigh: number
): string {
  return `${symbol}_${direction}_${timeframe}_${Math.floor(entryHigh)}`;
}

export function buildSnapshotCandidateId(
  symbol: string,
  direction: "long" | "short",
  timeframe: "4h" | "1h",
  entryHigh: number,
  createdAt: number
): string {
  return `${buildId(symbol, direction, timeframe, entryHigh)}_${createdAt}`;
}

function defaultExecutionOutcome(
  alertStatus: AlertPayload["alertStatus"]
): SnapshotExecutionOutcome {
  if (alertStatus === "blocked_by_macro") return "blocked_by_macro";
  if (alertStatus === "sent") return "sent";
  if (alertStatus === "failed") return "failed";
  return "pending";
}

function snapshotAlertStatusForOutcome(
  outcome: SnapshotExecutionOutcome
): SnapshotAlertStatus {
  return outcome;
}

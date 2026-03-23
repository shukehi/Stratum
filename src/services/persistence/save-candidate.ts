import Database from "better-sqlite3";
import type { AlertPayload } from "../../domain/signal/alert-payload.js";
import type { DailyBias } from "../../domain/market/daily-bias.js";
import type { OrderFlowBias } from "../../domain/market/order-flow.js";
import type { PositionSizingSummary } from "../../domain/signal/position-sizing.js";
import { buildSignalId } from "../../utils/signal-id.js";

/**
 * 候选信号持久化逻辑 (V2 Physics)
 */

export type CandidatePersistenceMeta = {
  confirmationStatus?: "pending" | "confirmed" | "invalidated";
  dailyBias?: DailyBias;
  orderFlowBias?: OrderFlowBias;
  positionSizing?: PositionSizingSummary;
  executionOutcome?: SnapshotExecutionOutcome;
  executionReasonCode?: string;
  deliveryStartedAt?: number;
  deliveryCompletedAt?: number;
};

export type SnapshotExecutionOutcome =
  | "pending"
  | "skipped_execution_gate"
  | "skipped_duplicate"
  | "sent"
  | "failed";

export type SnapshotAlertStatus =
  | "pending"
  | "skipped_execution_gate"
  | "skipped_duplicate"
  | "sent"
  | "failed";

export type CandidateSnapshotRow = {
  id: number;
  candidateId: string;
  baseCandidateId: string;
  symbol: string;
  direction: "long" | "short";
  timeframe: "4h" | "1h";
  capitalVelocityScore: number;
  alertStatus: SnapshotAlertStatus;
  confirmationStatus: string | null;
  regime: string | null;
  participantPressureType: string | null;
  dailyBias: string | null;
  orderFlowBias: string | null;
  basisDivergence: boolean;
  liquiditySession: string | null;
  deliveryStartedAt: number | null;
  deliveryCompletedAt: number | null;
  executionOutcome: SnapshotExecutionOutcome | null;
  executionReasonCode: string | null;
  createdAt: number;
};

// ── 写入操作 ────────────────────────────────────────────────────────────────

export function saveCandidate(
  db: Database.Database,
  payload: AlertPayload,
  meta: CandidatePersistenceMeta = {}
): void {
  const { candidate: c, alertStatus, createdAt } = payload;
  const ctx = payload.marketContext;
  const id = buildId(c.symbol, c.direction, c.timeframe, c.entryHigh);
  const now = Date.now();

  db.prepare(`
    INSERT OR REPLACE INTO candidates (
      id, symbol, direction, timeframe,
      entry_low, entry_high, stop_loss, take_profit, risk_reward,
      capital_velocity_score, regime_aligned, participant_aligned,
      structure_reason, context_reason,
      reason_codes, alert_status, created_at, updated_at,
      recommended_position_size, recommended_base_size, risk_amount, account_risk_percent,
      same_direction_exposure_count, same_direction_exposure_risk_percent,
      projected_same_direction_risk_percent, portfolio_open_risk_percent,
      projected_portfolio_risk_percent,
      delivery_started_at, delivery_completed_at,
      confirmation_status, daily_bias, order_flow_bias,
      regime, regime_confidence, market_driver_type,
      participant_bias, participant_pressure_type, participant_confidence,
      basis_divergence, liquidity_session
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?,
      ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?
    )
  `).run(
    id, c.symbol, c.direction, c.timeframe,
    c.entryLow, c.entryHigh, c.stopLoss, c.takeProfit, c.riskReward,
    c.capitalVelocityScore, c.regimeAligned ? 1 : 0, c.participantAligned ? 1 : 0,
    c.structureReason, c.contextReason,
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
    meta.deliveryStartedAt ?? null,
    meta.deliveryCompletedAt ?? null,
    meta.confirmationStatus ?? null,
    meta.dailyBias ?? null,
    meta.orderFlowBias ?? null,
    ctx.regime ?? null,
    ctx.regimeConfidence ?? null,
    ctx.marketDriverType ?? null,
    ctx.participantBias ?? null,
    ctx.participantPressureType ?? null,
    ctx.participantConfidence ?? null,
    ctx.basisDivergence ? 1 : 0,
    ctx.liquiditySession ?? null
  );
}

export function saveCandidateSnapshot(
  db: Database.Database,
  payload: AlertPayload,
  meta: CandidatePersistenceMeta = {}
): string {
  const { candidate: c, alertStatus, createdAt, marketContext: ctx } = payload;
  const baseCandidateId = buildId(c.symbol, c.direction, c.timeframe, c.entryHigh);
  const candidateId = buildSnapshotCandidateId(c.symbol, c.direction, c.timeframe, c.entryHigh, createdAt);

  db.prepare(`
    INSERT INTO candidate_snapshots (
      candidate_id, base_candidate_id, symbol, direction, timeframe,
      entry_low, entry_high, stop_loss, take_profit, risk_reward,
      capital_velocity_score, regime_aligned, participant_aligned,
      structure_reason, context_reason, reason_codes,
      alert_status, confirmation_status,
      recommended_position_size, recommended_base_size, risk_amount, account_risk_percent,
      same_direction_exposure_count, same_direction_exposure_risk_percent,
      projected_same_direction_risk_percent, portfolio_open_risk_percent,
      projected_portfolio_risk_percent,
      delivery_started_at, delivery_completed_at,
      daily_bias, order_flow_bias,
      regime, regime_confidence, market_driver_type,
      participant_bias, participant_pressure_type, participant_confidence,
      basis_divergence, liquidity_session,
      execution_outcome, execution_reason_code,
      created_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?,
      ?, ?,
      ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?,
      ?
    )
  `).run(
    candidateId, baseCandidateId, c.symbol, c.direction, c.timeframe,
    c.entryLow, c.entryHigh, c.stopLoss, c.takeProfit, c.riskReward,
    c.capitalVelocityScore, c.regimeAligned ? 1 : 0, c.participantAligned ? 1 : 0,
    c.structureReason, c.contextReason, JSON.stringify(c.reasonCodes),
    alertStatus, meta.confirmationStatus ?? null,
    meta.positionSizing?.recommendedPositionSize ?? null,
    meta.positionSizing?.recommendedBaseSize ?? null,
    meta.positionSizing?.riskAmount ?? null,
    meta.positionSizing?.accountRiskPercent ?? null,
    meta.positionSizing?.sameDirectionExposureCount ?? null,
    meta.positionSizing?.sameDirectionExposureRiskPercent ?? null,
    meta.positionSizing?.projectedSameDirectionRiskPercent ?? null,
    meta.positionSizing?.portfolioOpenRiskPercent ?? null,
    meta.positionSizing?.projectedPortfolioRiskPercent ?? null,
    meta.deliveryStartedAt ?? null,
    meta.deliveryCompletedAt ?? null,
    meta.dailyBias ?? null,
    meta.orderFlowBias ?? null,
    ctx.regime ?? null,
    ctx.regimeConfidence ?? null,
    ctx.marketDriverType ?? null,
    ctx.participantBias ?? null,
    ctx.participantPressureType ?? null,
    ctx.participantConfidence ?? null,
    ctx.basisDivergence ? 1 : 0,
    ctx.liquiditySession ?? null,
    meta.executionOutcome ?? "pending",
    meta.executionReasonCode ?? null,
    createdAt
  );

  return candidateId;
}

// ── 读取操作 ────────────────────────────────────────────────────────────────

export function loadCandidateSnapshots(
  db: Database.Database,
  limit = 100
): CandidateSnapshotRow[] {
  const rows = db.prepare(`
    SELECT
      id,
      candidate_id AS candidateId,
      base_candidate_id AS baseCandidateId,
      symbol,
      direction,
      timeframe,
      capital_velocity_score AS capitalVelocityScore,
      alert_status AS alertStatus,
      confirmation_status AS confirmationStatus,
      regime,
      participant_pressure_type AS participantPressureType,
      daily_bias AS dailyBias,
      order_flow_bias AS orderFlowBias,
      basis_divergence AS basisDivergence,
      liquidity_session AS liquiditySession,
      delivery_started_at AS deliveryStartedAt,
      delivery_completed_at AS deliveryCompletedAt,
      execution_outcome AS executionOutcome,
      execution_reason_code AS executionReasonCode,
      created_at AS createdAt
    FROM candidate_snapshots
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(limit) as any[];

  return rows.map((r) => ({
    ...r,
    basisDivergence: r.basisDivergence === 1,
  }));
}

export function countCandidateSnapshotsByStatus(
  db: Database.Database,
  status: SnapshotAlertStatus
): number {
  const row = db.prepare("SELECT COUNT(*) AS cnt FROM candidate_snapshots WHERE alert_status = ?").get(status) as { cnt: number };
  return row.cnt;
}

// ── 更新与辅助 ────────────────────────────────────────────────────────────────

export function updateAlertStatus(db: Database.Database, symbol: string, direction: string, timeframe: string, entryHigh: number, status: string, options: { deliveryCompletedAt?: number } = {}): void {
  const id = buildId(symbol, direction, timeframe, entryHigh);
  db.prepare(`
    UPDATE candidates
    SET alert_status = ?, delivery_completed_at = COALESCE(?, delivery_completed_at), updated_at = ?
    WHERE id = ?
  `).run(status, options.deliveryCompletedAt ?? null, Date.now(), id);
}

export function updateCandidateSnapshotOutcome(db: Database.Database, candidateId: string, outcome: SnapshotExecutionOutcome, options: { alertStatus?: SnapshotAlertStatus; executionReasonCode?: string; deliveryCompletedAt?: number; } = {}): void {
  db.prepare(`
    UPDATE candidate_snapshots
    SET execution_outcome = ?, execution_reason_code = ?, alert_status = COALESCE(?, alert_status), delivery_completed_at = COALESCE(?, delivery_completed_at)
    WHERE candidate_id = ?
  `).run(outcome, options.executionReasonCode ?? null, options.alertStatus ?? outcome, options.deliveryCompletedAt ?? null, candidateId);
}

export function markCandidateDeliveryStarted(db: Database.Database, symbol: string, direction: string, timeframe: string, entryHigh: number, startedAt: number): void {
  const id = buildId(symbol, direction, timeframe, entryHigh);
  db.prepare(`UPDATE candidates SET delivery_started_at = ?, updated_at = ? WHERE id = ?`).run(startedAt, Date.now(), id);
}

export function markCandidateSnapshotDeliveryStarted(db: Database.Database, candidateId: string, startedAt: number): void {
  db.prepare(`UPDATE candidate_snapshots SET delivery_started_at = ? WHERE candidate_id = ?`).run(startedAt, candidateId);
}

export function buildId(symbol: string, direction: string, timeframe: string, entryHigh: number): string {
  return buildSignalId(symbol, direction, timeframe, entryHigh);
}

export function buildSnapshotCandidateId(symbol: string, direction: string, timeframe: string, entryHigh: number, createdAt: number): string {
  return `${buildId(symbol, direction, timeframe, entryHigh)}_${createdAt}`;
}

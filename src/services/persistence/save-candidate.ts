import Database from "better-sqlite3";
import type { AlertPayload } from "../../domain/signal/alert-payload.js";

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
export function saveCandidate(db: Database.Database, payload: AlertPayload): void {
  const { candidate: c, alertStatus, createdAt } = payload;
  const id = buildId(c.symbol, c.direction, c.timeframe, c.entryHigh);
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO candidates (
      id, symbol, direction, timeframe,
      entry_low, entry_high, stop_loss, take_profit, risk_reward,
      signal_grade, regime_aligned, participant_aligned,
      structure_reason, context_reason, macro_reason,
      reason_codes, alert_status, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?
    )
  `);

  stmt.run(
    id, c.symbol, c.direction, c.timeframe,
    c.entryLow, c.entryHigh, c.stopLoss, c.takeProfit, c.riskReward,
    c.signalGrade, c.regimeAligned ? 1 : 0, c.participantAligned ? 1 : 0,
    c.structureReason, c.contextReason, c.macroReason ?? null,
    JSON.stringify(c.reasonCodes), alertStatus, createdAt, now
  );
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

// ── 内部辅助 ──────────────────────────────────────────────────────────────────

export function buildId(
  symbol: string,
  direction: string,
  timeframe: string,
  entryHigh: number
): string {
  return `${symbol}_${direction}_${timeframe}_${Math.floor(entryHigh)}`;
}

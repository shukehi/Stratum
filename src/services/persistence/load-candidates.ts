import Database from "better-sqlite3";
import type { AlertPayload } from "../../domain/signal/alert-payload.js";
import type { TradeCandidate } from "../../domain/signal/trade-candidate.js";
import type { MarketContext } from "../../domain/market/market-context.js";
import type { ReasonCode } from "../../domain/common/reason-code.js";
import { buildId } from "./save-candidate.js";

/**
 * 候補読み込み  (PHASE_08)
 *
 * candidates テーブルから最近の AlertPayload を読み込む。
 *
 * 用途:
 *   - 重複アラート抑制（同一シグナルが短期間に再評価された場合に再送しない）
 *   - 最終信号の監査ログ確認
 *
 * limitHours: 過去 N 時間以内に作成されたレコードのみ返す（デフォルト 24h）
 */

type CandidateRow = {
  id: string;
  symbol: string;
  direction: string;
  timeframe: string;
  entry_low: number;
  entry_high: number;
  stop_loss: number;
  take_profit: number;
  risk_reward: number;
  signal_grade: string;
  regime_aligned: number;
  participant_aligned: number;
  structure_reason: string;
  context_reason: string;
  macro_reason: string | null;
  reason_codes: string;
  alert_status: string;
  created_at: number;
  updated_at: number;
};

function rowToPayload(row: CandidateRow): AlertPayload {
  const candidate: TradeCandidate = {
    symbol: row.symbol,
    direction: row.direction as "long" | "short",
    timeframe: row.timeframe as "4h" | "1h",
    entryLow: row.entry_low,
    entryHigh: row.entry_high,
    stopLoss: row.stop_loss,
    takeProfit: row.take_profit,
    riskReward: row.risk_reward,
    signalGrade: row.signal_grade as TradeCandidate["signalGrade"],
    regimeAligned: row.regime_aligned === 1,
    participantAligned: row.participant_aligned === 1,
    structureReason: row.structure_reason,
    contextReason: row.context_reason,
    macroReason: row.macro_reason ?? undefined,
    reasonCodes: JSON.parse(row.reason_codes) as ReasonCode[],
  };

  // marketContext はストアしていないため、最小限のプレースホルダーを返す
  const marketContext: MarketContext = {
    regime: "trend",
    regimeConfidence: 0,
    regimeReasons: [],
    participantBias: "balanced",
    participantPressureType: "none",
    participantConfidence: 0,
    participantRationale: "",
    spotPerpBasis: 0,
    basisDivergence: false,
    liquiditySession: "new_york_open",
    summary: "",
    reasonCodes: [],
  };

  return {
    candidate,
    marketContext,
    alertStatus: row.alert_status as AlertPayload["alertStatus"],
    createdAt: row.created_at,
  };
}

export function loadRecentCandidates(
  db: Database.Database,
  limitHours = 24
): AlertPayload[] {
  const since = Date.now() - limitHours * 60 * 60 * 1000;
  const rows = db
    .prepare("SELECT * FROM candidates WHERE created_at >= ? ORDER BY created_at DESC")
    .all(since) as CandidateRow[];
  return rows.map(rowToPayload);
}

/**
 * 単一候補を ID で取得する（send-alert.ts の重複チェックに使用）。
 * symbol + direction + timeframe + entryHigh から ID を組み立てる。
 */
export function findCandidate(
  db: Database.Database,
  symbol: string,
  direction: "long" | "short",
  timeframe: "4h" | "1h",
  entryHigh: number
): AlertPayload | undefined {
  const id = buildId(symbol, direction, timeframe, entryHigh);
  const row = db
    .prepare("SELECT * FROM candidates WHERE id = ?")
    .get(id) as CandidateRow | undefined;
  return row ? rowToPayload(row) : undefined;
}

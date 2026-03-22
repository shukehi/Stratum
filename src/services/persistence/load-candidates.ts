import Database from "better-sqlite3";
import type { AlertPayload } from "../../domain/signal/alert-payload.js";
import type { TradeCandidate } from "../../domain/signal/trade-candidate.js";
import type { MarketContext } from "../../domain/market/market-context.js";
import type { ReasonCode } from "../../domain/common/reason-code.js";
import { buildId } from "./save-candidate.js";

/**
 * 候选信号读取  (PHASE_08)
 *
 * 从 `candidates` 表读取最近的 `AlertPayload` 记录。
 *
 * 主要用途：
 *   - 抑制短时间内重复发送同一信号；
 *   - 回看最近一次信号的完整上下文。
 *
 * `limitHours` 表示仅返回最近 N 小时内创建的记录，默认 24 小时。
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
  macro_action: string | null;
  confirmation_status: string | null;
  daily_bias: string | null;
  order_flow_bias: string | null;
  regime: string | null;
  regime_confidence: number | null;
  market_driver_type: string | null;
  participant_bias: string | null;
  participant_pressure_type: string | null;
  participant_confidence: number | null;
  basis_divergence: number;
  liquidity_session: string | null;
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

  // `marketContext` 未完整持久化，因此这里只回填最小可用占位结构
  const marketContext: MarketContext = {
    regime: (row.regime as MarketContext["regime"]) ?? "trend",
    regimeConfidence: row.regime_confidence ?? 0,
    regimeReasons: [],
    marketDriverType: row.market_driver_type as MarketContext["marketDriverType"],
    participantBias: (row.participant_bias as MarketContext["participantBias"]) ?? "balanced",
    participantPressureType:
      (row.participant_pressure_type as MarketContext["participantPressureType"]) ?? "none",
    participantConfidence: row.participant_confidence ?? 0,
    participantRationale: "",
    spotPerpBasis: 0,
    basisDivergence: row.basis_divergence === 1,
    liquiditySession: (row.liquidity_session as MarketContext["liquiditySession"]) ?? "ny_close",
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
 * 按确定性 ID 读取单条候选记录，供告警去重检查使用。
 * ID 由 `symbol + direction + timeframe + entryHigh` 组合生成。
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

import Database from "better-sqlite3";
import type { OpenPosition, PositionStatus } from "../../domain/position/open-position.js";
import type { TradeCandidate } from "../../domain/signal/trade-candidate.js";

/**
 * 仓位追踪服务  (PHASE_10-B)
 *
 * 职责:
 *   - openPosition:         信号发送成功后记录开仓
 *   - closePosition:        手动或自动平仓，计算 pnlR
 *   - getOpenPositions:     获取当前所有 "open" 仓位
 *   - countOpenByDirection: 获取指定方向的仓位数（供 evaluateConsensus 使用）
 *   - findPosition:         按 ID 查找单个仓位
 *
 * pnlR 计算（第一性原理）:
 *   entryMid = (entryLow + entryHigh) / 2
 *   long  pnlR = (closePrice - entryMid) / (entryMid - stopLoss)
 *   short pnlR = (entryMid - closePrice) / (stopLoss - entryMid)
 */

type PositionRow = {
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
  recommended_position_size: number | null;
  recommended_base_size: number | null;
  risk_amount: number | null;
  account_risk_percent: number | null;
  status: string;
  opened_at: number;
  closed_at: number | null;
  close_price: number | null;
  pnl_r: number | null;
};

export type PositionRiskMeta = {
  recommendedPositionSize?: number;
  recommendedBaseSize?: number;
  riskAmount?: number;
  accountRiskPercent?: number;
};

export type OpenRiskSummary = {
  openCount: number;
  openRiskAmount: number;
  openRiskPercent: number;
};

// ── 主キー生成 ────────────────────────────────────────────────────────────

export function buildPositionId(
  symbol: string,
  direction: string,
  timeframe: string,
  entryHigh: number
): string {
  return `${symbol}_${direction}_${timeframe}_${Math.floor(entryHigh)}`;
}

// ── 開仓 ──────────────────────────────────────────────────────────────────

export function openPosition(
  db: Database.Database,
  candidate: TradeCandidate,
  openedAt: number = Date.now(),
  riskMeta: PositionRiskMeta = {}
): void {
  const id = buildPositionId(
    candidate.symbol,
    candidate.direction,
    candidate.timeframe,
    candidate.entryHigh
  );

  db.prepare(`
    INSERT OR IGNORE INTO positions (
      id, symbol, direction, timeframe,
      entry_low, entry_high, stop_loss, take_profit, risk_reward,
      signal_grade, recommended_position_size, recommended_base_size,
      risk_amount, account_risk_percent, status, opened_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
  `).run(
    id,
    candidate.symbol,
    candidate.direction,
    candidate.timeframe,
    candidate.entryLow,
    candidate.entryHigh,
    candidate.stopLoss,
    candidate.takeProfit,
    candidate.riskReward,
    candidate.signalGrade,
    riskMeta.recommendedPositionSize ?? null,
    riskMeta.recommendedBaseSize ?? null,
    riskMeta.riskAmount ?? null,
    riskMeta.accountRiskPercent ?? null,
    openedAt
  );
}

// ── 平仓 ──────────────────────────────────────────────────────────────────

export function closePosition(
  db: Database.Database,
  symbol: string,
  direction: "long" | "short",
  timeframe: "4h" | "1h",
  entryHigh: number,
  closePrice: number,
  status: Exclude<PositionStatus, "open">,
  closedAt: number = Date.now()
): void {
  const id = buildPositionId(symbol, direction, timeframe, entryHigh);

  const row = db
    .prepare("SELECT entry_low, entry_high, stop_loss FROM positions WHERE id = ?")
    .get(id) as { entry_low: number; entry_high: number; stop_loss: number } | undefined;

  if (!row) return; // 存在しない仓位は無視

  const entryMid = (row.entry_low + row.entry_high) / 2;
  const risk = Math.abs(entryMid - row.stop_loss);
  const pnlR =
    risk > 0
      ? direction === "long"
        ? (closePrice - entryMid) / risk
        : (entryMid - closePrice) / risk
      : 0;

  db.prepare(`
    UPDATE positions
    SET status = ?, closed_at = ?, close_price = ?, pnl_r = ?
    WHERE id = ?
  `).run(status, closedAt, closePrice, pnlR, id);
}

// ── クエリ ────────────────────────────────────────────────────────────────

export function getOpenPositions(db: Database.Database): OpenPosition[] {
  const rows = db
    .prepare("SELECT * FROM positions WHERE status = 'open' ORDER BY opened_at DESC")
    .all() as PositionRow[];
  return rows.map(rowToPosition);
}

/**
 * 指定方向の open 仓位数を返す。
 * evaluateConsensus の openLongCount / openShortCount に渡すことで
 * 相関性暴露制限（門槛 7）を実効化する。
 */
export function countOpenByDirection(
  db: Database.Database,
  direction: "long" | "short"
): number {
  const row = db
    .prepare(
      "SELECT COUNT(*) as n FROM positions WHERE status = 'open' AND direction = ?"
    )
    .get(direction) as { n: number };
  return row.n;
}

export function getOpenRiskSummary(
  db: Database.Database,
  direction?: "long" | "short"
): OpenRiskSummary {
  const baseSql = `
    SELECT
      COUNT(*) as open_count,
      COALESCE(SUM(COALESCE(risk_amount, 0)), 0) as open_risk_amount,
      COALESCE(SUM(account_risk_percent), 0) as open_risk_percent
    FROM positions
    WHERE status = 'open'
  `;
  const row = direction
    ? db.prepare(`${baseSql} AND direction = ?`).get(direction)
    : db.prepare(baseSql).get();

  const typedRow = row as {
    open_count: number;
    open_risk_amount: number;
    open_risk_percent: number;
  };

  return {
    openCount: typedRow.open_count,
    openRiskAmount: typedRow.open_risk_amount,
    openRiskPercent: typedRow.open_risk_percent,
  };
}

export function findPosition(
  db: Database.Database,
  symbol: string,
  direction: "long" | "short",
  timeframe: "4h" | "1h",
  entryHigh: number
): OpenPosition | undefined {
  const id = buildPositionId(symbol, direction, timeframe, entryHigh);
  const row = db
    .prepare("SELECT * FROM positions WHERE id = ?")
    .get(id) as PositionRow | undefined;
  return row ? rowToPosition(row) : undefined;
}

// ── 内部变换 ────────────────────────────────────────────────────────────────

function rowToPosition(row: PositionRow): OpenPosition {
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
    signalGrade: row.signal_grade as OpenPosition["signalGrade"],
    status: row.status as PositionStatus,
    openedAt: row.opened_at,
    closedAt: row.closed_at ?? undefined,
    closePrice: row.close_price ?? undefined,
    pnlR: row.pnl_r ?? undefined,
  };
}

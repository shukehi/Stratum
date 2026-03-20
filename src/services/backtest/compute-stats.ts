import type { BacktestTrade, BacktestStats } from "../../domain/backtest/backtest-types.js";

/**
 * バックテスト統計計算  (PHASE_10-C)
 *
 * 純粋関数 — 外部依存なし、副作用なし。
 *
 * Sharpe 比の定義（取引ベース、年率化なし）:
 *   sharpe = mean(pnlR) / std(pnlR)
 *   pnlR が 2 件未満（標準偏差が計算不能）の場合は 0 を返す。
 *
 * maxDrawdownR の定義:
 *   累積 R 曲線のピーク後の最大下落幅。
 *   例: cumR = [0, 1, 3, 1, 2, -1] → peak=3, trough=-1 → maxDD=4.0R
 *
 * winRate:
 *   wins / closedTrades。closedTrades=0 の場合は 0（ゼロ除算回避）。
 */
export function computeStats(trades: BacktestTrade[]): BacktestStats {
  const closed = trades.filter(
    (t) => t.status === "closed_tp" || t.status === "closed_sl"
  );
  const wins = closed.filter((t) => t.status === "closed_tp").length;
  const losses = closed.filter((t) => t.status === "closed_sl").length;
  const expired = trades.filter((t) => t.status === "expired").length;

  const closedPnls = closed.map((t) => t.pnlR);
  const totalR = closedPnls.reduce((s, r) => s + r, 0);
  const avgPnlR = closed.length > 0 ? totalR / closed.length : 0;

  return {
    totalTrades: trades.length,
    closedTrades: closed.length,
    wins,
    losses,
    expired,
    winRate: closed.length > 0 ? wins / closed.length : 0,
    avgPnlR,
    totalR,
    maxDrawdownR: computeMaxDrawdown(closedPnls),
    sharpeRatio: computeSharpe(closedPnls),
  };
}

// ── 内部ヘルパー ───────────────────────────────────────────────────────────

/**
 * 累積 R 曲線の最大ドローダウンを計算する（正値で返す）。
 */
export function computeMaxDrawdown(pnls: number[]): number {
  if (pnls.length === 0) return 0;

  let peak = 0;
  let cumulative = 0;
  let maxDD = 0;

  for (const pnl of pnls) {
    cumulative += pnl;
    if (cumulative > peak) peak = cumulative;
    const dd = peak - cumulative;
    if (dd > maxDD) maxDD = dd;
  }

  return maxDD;
}

/**
 * 取引単位の Sharpe 比を計算する。
 * mean(pnlR) / std(pnlR)、取引数 < 2 の場合は 0。
 */
export function computeSharpe(pnls: number[]): number {
  if (pnls.length < 2) return 0;

  const mean = pnls.reduce((s, r) => s + r, 0) / pnls.length;
  const variance =
    pnls.reduce((s, r) => s + (r - mean) ** 2, 0) / (pnls.length - 1);
  const std = Math.sqrt(variance);

  return std > 0 ? mean / std : 0;
}

import type { BacktestTrade, BacktestStats } from "../../domain/backtest/backtest-types.js";

/**
 * 回测统计计算  (PHASE_10-C)
 *
 * 纯函数，无外部依赖、无副作用。
 *
 * 指标定义：
 *   - `sharpe = mean(pnlR) / std(pnlR)`，不做年化；
 *   - `maxDrawdownR` 表示累计 R 曲线从峰值回落的最大幅度；
 *   - `winRate = wins / closedTrades`，若无已平仓交易则返回 0。
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

// ── 内部辅助 ────────────────────────────────────────────────────────────────

/**
 * 计算累计 R 曲线的最大回撤，返回正值。
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
 * 按交易粒度计算 Sharpe 比。
 * 即 `mean(pnlR) / std(pnlR)`；若交易数少于 2，则返回 0。
 */
export function computeSharpe(pnls: number[]): number {
  if (pnls.length < 2) return 0;

  const mean = pnls.reduce((s, r) => s + r, 0) / pnls.length;
  const variance =
    pnls.reduce((s, r) => s + (r - mean) ** 2, 0) / (pnls.length - 1);
  const std = Math.sqrt(variance);

  return std > 0 ? mean / std : 0;
}

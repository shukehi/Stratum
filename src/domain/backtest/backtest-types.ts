// PHASE_10-C 已冻结：不要修改字段定义

/**
 * 回测领域类型  (PHASE_10-C)
 *
 * 设计原则：
 *   - `BacktestSignal`：结构检测在某一时刻输出的信号快照；
 *   - `BacktestTrade`：该信号经过交易模拟后的结果；
 *   - `BacktestStats`：所有交易汇总后的统计摘要。
 *
 * 入场价格沿用保守最差成交假设：
 *   - 做多使用 `entryHigh`；
 *   - 做空使用 `entryLow`。
 */

export type BacktestSignal = {
  /** 在 `candles4h` 数组中的触发索引。 */
  candleIndex: number;
  direction: "long" | "short";
  /** 入场区上沿，做多时也作为保守成交价。 */
  entryHigh: number;
  /** 入场区下沿，做空时也作为保守成交价。 */
  entryLow: number;
  stopLoss: number;
  takeProfit: number;
  structureScore: number;
  structureReason: string;
};

export type BacktestTradeStatus = "closed_tp" | "closed_sl" | "expired";

export type BacktestTrade = {
  signal: BacktestSignal;
  /** 实际采用的入场价格：做多为 `entryHigh`，做空为 `entryLow`。 */
  entryPrice: number;
  /** 实际出场价格，可能是 TP、SL 或最后一根收盘价。 */
  exitPrice: number;
  /** 出场确认时在 `candles4h` 中对应的索引。 */
  exitCandleIndex: number;
  status: BacktestTradeStatus;
  /** 以 R 倍数表示的盈亏，`+1.0R` 表示赚到一倍风险金额。 */
  pnlR: number;
};

export type BacktestStats = {
  totalTrades: number;
  closedTrades: number;     // closed_tp + closed_sl
  wins: number;             // closed_tp
  losses: number;           // closed_sl
  expired: number;          // 到数据尾部仍未平仓的交易数
  /** `wins / closedTrades`；若 `closedTrades=0` 则返回 0。 */
  winRate: number;
  /** 已平仓交易 `pnlR` 的平均值，可视作期望值。 */
  avgPnlR: number;
  /** 已平仓交易 `pnlR` 的合计值。 */
  totalR: number;
  /** 累计 R 曲线的最大回撤。 */
  maxDrawdownR: number;
  /** Sharpe 比，定义为 `mean(pnlR) / std(pnlR)`；交易数少于 2 时为 0。 */
  sharpeRatio: number;
};

// PHASE_10-C FROZEN — do not modify fields

/**
 * バックテスト用ドメイン型  (PHASE_10-C)
 *
 * 設計原則:
 *   - BacktestSignal: 構造検出が出力したシグナルのスナップショット
 *   - BacktestTrade:  シミュレーション後の取引結果（pnlR 付き）
 *   - BacktestStats:  全取引の統計サマリー
 *
 * エントリー価格は entryHigh（保守的最悪フィル）を採用:
 *   long:  entryHigh で買い（高い方 = 不利フィル）
 *   short: entryLow  で売り（低い方 = 不利フィル）
 */

export type BacktestSignal = {
  /** candles4h 配列における発火インデックス */
  candleIndex: number;
  direction: "long" | "short";
  /** エントリーゾーン上端（long の保守的フィル価格） */
  entryHigh: number;
  /** エントリーゾーン下端（short の保守的フィル価格） */
  entryLow: number;
  stopLoss: number;
  takeProfit: number;
  structureScore: number;
  structureReason: string;
};

export type BacktestTradeStatus = "closed_tp" | "closed_sl" | "expired";

export type BacktestTrade = {
  signal: BacktestSignal;
  /** 実際のエントリー価格（long=entryHigh, short=entryLow）*/
  entryPrice: number;
  /** 実際のエグジット価格（TP/SL 値、または最終足の終値）*/
  exitPrice: number;
  /** エグジットが確定した candles4h インデックス */
  exitCandleIndex: number;
  status: BacktestTradeStatus;
  /** R 倍数での損益（+1.0R = 1 リスク分の利益）*/
  pnlR: number;
};

export type BacktestStats = {
  totalTrades: number;
  closedTrades: number;     // closed_tp + closed_sl
  wins: number;             // closed_tp
  losses: number;           // closed_sl
  expired: number;          // データ終端まで未決済
  /** wins / closedTrades (closedTrades=0 の場合は 0) */
  winRate: number;
  /** closedTrades の pnlR 平均（期待値） */
  avgPnlR: number;
  /** closedTrades の pnlR 合計 */
  totalR: number;
  /** 累積 R 曲線の最大ドローダウン */
  maxDrawdownR: number;
  /** Sharpe 比（pnlR の平均 / 標準偏差、<2 取引の場合は 0） */
  sharpeRatio: number;
};

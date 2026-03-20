// PHASE_10-B FROZEN — do not modify fields
import type { TradeCandidate } from "../signal/trade-candidate.js";

/**
 * 仓位状态枚举
 *   open         - 仓位已开启，未平仓
 *   closed_tp    - 止盈平仓（价格到达 takeProfit）
 *   closed_sl    - 止损平仓（价格到达 stopLoss）
 *   closed_manual- 手动平仓（用户干预）
 */
export type PositionStatus =
  | "open"
  | "closed_tp"
  | "closed_sl"
  | "closed_manual";

/**
 * 开仓记录  (PHASE_10-B)
 *
 * id 与 candidates 表共用相同的确定性主键格式:
 *   {symbol}_{direction}_{timeframe}_{Math.floor(entryHigh)}
 *
 * pnlR: 以风险倍数（R）衡量的盈亏
 *   +1.0R = 赚了 1 倍风险金额
 *   -1.0R = 亏了 1 倍风险金额（止损出局）
 *   通过 takeProfit 到达计算 ((closePrice - entryMid) / (entryMid - stopLoss))
 */
export type OpenPosition = {
  id: string;
  symbol: string;
  direction: "long" | "short";
  timeframe: "4h" | "1h";
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  signalGrade: TradeCandidate["signalGrade"];
  openedAt: number;   // Unix ms — 仓位开启时间（= alert 发送时间）
  status: PositionStatus;
  closedAt?: number;  // Unix ms — 平仓时间（status !== "open" の場合のみ）
  closePrice?: number;
  pnlR?: number;      // 平仓后填充
};

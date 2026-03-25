import Database from "better-sqlite3";
import type { ExchangeClient } from "../../clients/exchange/ccxt-client.js";
import type { OpenPosition } from "../../domain/position/open-position.js";
import { getOpenPositions, closePosition, activateBreakEven } from "../positions/track-position.js";
import { logger } from "../../app/logger.js";
import { env } from "../../app/env.js";

/**
 * 模拟交易仓位监控器 (V3 Physics + FSD Silent)
 * 
 * 职责：
 *   1. 30s 轮询实时价格。
 *   2. [物理防御] 当 Unrealized PnL >= 1.0R 时，自动触发 Break-Even (移动 SL 进场位)。
 *   3. [自动驾驶] 触及 TP/SL 自动平仓，无碳基干预。
 *   4. [静默遥测] 遵循 No News Is Good News，常规平仓不发送通知。
 */

export type ClosedPositionRecord = {
  position: OpenPosition;
  exitPrice: number;
  status: "closed_tp" | "closed_sl" | "closed_manual";
  pnlR: number;
};

export type MonitorResult = {
  symbol: string;
  currentPrice: number;
  checked: number;
  closed: number;
  closedRecords: ClosedPositionRecord[];
};

export async function monitorPositions(
  db: Database.Database,
  client: ExchangeClient,
  symbol: string,
  _notificationConfig?: any, // FSD Mode: 忽略通知配置
  closedAt: number = Date.now()
): Promise<MonitorResult> {
  const openPositions = getOpenPositions(db, env.EXECUTION_MODE as "paper" | "live").filter(p => p.symbol === symbol);

  if (openPositions.length === 0) {
    return { symbol, currentPrice: 0, checked: 0, closed: 0, closedRecords: [] };
  }

  let currentPrice: number;
  try {
    const ticker = await client.fetchTicker(symbol);
    currentPrice = ticker.last;
  } catch (err) {
    logger.warn({ symbol, err }, "monitorPositions: 获取价格失败");
    return { symbol, currentPrice: 0, checked: openPositions.length, closed: 0, closedRecords: [] };
  }

  const closedRecords: ClosedPositionRecord[] = [];

  for (const pos of openPositions) {
    // ── 1. 物理防御检查 (Break-Even) ──────────────────────────────────────
    const entryMid = (pos.entryLow + pos.entryHigh) / 2;
    const initialRisk = Math.abs(entryMid - pos.stopLoss);
    
    if (initialRisk > 0) {
      const currentPnlR = pos.direction === "long" 
        ? (currentPrice - entryMid) / initialRisk
        : (entryMid - currentPrice) / initialRisk;

      // 如果位移达到 1.0R 且防热盾未上锁
      if (currentPnlR >= 1.0 && !pos.beActivated) {
        // 补偿摩擦力：BE 价格略微偏移以覆盖手续费
        const frictionOffset = initialRisk * 0.05; // 假设 5% 的风险额作为双向摩擦
        const bePrice = pos.direction === "long" ? entryMid + frictionOffset : entryMid - frictionOffset;
        
        activateBreakEven(db, pos.id, bePrice);
        logger.info({ symbol: pos.symbol, pnlR: currentPnlR.toFixed(2) }, "FSD Physics: Break-Even Activated. 防热盾已上锁。");
        // 更新本地对象状态以供本次循环后续逻辑使用
        pos.stopLoss = bePrice;
        pos.beActivated = true;
      }
    }

    // ── 2. 平仓判定 ────────────────────────────────────────────────────────
    const hit = checkHit(pos, currentPrice);
    if (!hit) continue;

    const exitPrice = currentPrice; // 以当前物理碰撞价平仓，而非预设价（模拟滑点）

    closePosition(db, pos.symbol, pos.direction, pos.timeframe, pos.entryHigh, exitPrice, hit);

    // 物理盈亏重算 (基于平仓时的快照)
    const risk = Math.abs(entryMid - (pos.beActivated ? entryMid : pos.stopLoss)); // 注意：如果已 BE，初始风险已变
    // 但为了 R 倍数统计的一致性，通常以初始风险为基准
    const finalPnlR = pos.direction === "long" ? (exitPrice - entryMid) / initialRisk : (entryMid - exitPrice) / initialRisk;

    closedRecords.push({ position: pos, exitPrice, status: hit, pnlR: finalPnlR });
    logger.info({ symbol: pos.symbol, status: hit, pnlR: finalPnlR.toFixed(2) }, "FSD Execution: Position Closed.");
  }

  return {
    symbol,
    currentPrice,
    checked: openPositions.length,
    closed: closedRecords.length,
    closedRecords
  };
}

function checkHit(pos: OpenPosition, price: number): "closed_tp" | "closed_sl" | null {
  if (pos.direction === "long") {
    if (price <= pos.stopLoss) return "closed_sl";
    if (price >= pos.takeProfit) return "closed_tp";
  } else {
    if (price >= pos.stopLoss) return "closed_sl";
    if (price <= pos.takeProfit) return "closed_tp";
  }
  return null;
}

export function getUnrealizedPnl(
  openPositions: OpenPosition[],
  currentPrice: number
): any[] {
  return openPositions.map((pos) => {
    const entryMid = (pos.entryLow + pos.entryHigh) / 2;
    const initialRisk = Math.abs(entryMid - pos.stopLoss);
    const unrealizedPnlR = initialRisk > 0
      ? pos.direction === "long" ? (currentPrice - entryMid) / initialRisk : (entryMid - currentPrice) / initialRisk
      : 0;

    return {
      position: pos,
      currentPrice,
      unrealizedPnlR,
      distanceToTp: (Math.abs(currentPrice - pos.takeProfit) / currentPrice) * 100,
      distanceToSl: (Math.abs(currentPrice - pos.stopLoss) / currentPrice) * 100,
    };
  });
}

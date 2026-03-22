import Database from "better-sqlite3";
import type { ExchangeClient } from "../../clients/exchange/ccxt-client.js";
import type { OpenPosition } from "../../domain/position/open-position.js";
import type { TelegramConfig } from "../alerting/send-alert.js";
import { getOpenPositions, closePosition } from "../positions/track-position.js";
import { logger } from "../../app/logger.js";

/**
 * 模拟交易仓位监控器  (PHASE_11)
 *
 * 职责：
 *   每次调用时从交易所获取当前价格，检查所有 open 仓位
 *   是否触及 TP 或 SL，触及则自动平仓并发送 Telegram 通知。
 *
 * 设计原则：
 *   - 无状态：每次调用独立运行，不依赖内存缓存
 *   - 保守判定：同一次报价同时触及 SL 和 TP → SL 优先
 *   - 优雅降级：获取价格失败 → 记录日志，跳过本轮检查，不抛出异常
 *
 * 未实现盈亏（Unrealized P&L）计算：
 *   通过 getUnrealizedPnl() 辅助函数独立计算，供 dashboard 使用。
 */

export type ClosedPositionRecord = {
  position: OpenPosition;
  exitPrice: number;
  status: "closed_tp" | "closed_sl";
  pnlR: number;
};

export type MonitorResult = {
  symbol: string;
  currentPrice: number;
  checked: number;       // 本次检查的 open 仓位数
  closed: number;        // 本次触发平仓的仓位数
  closedRecords: ClosedPositionRecord[];
};

export type UnrealizedPosition = {
  position: OpenPosition;
  currentPrice: number;
  unrealizedPnlR: number;    // 当前未实现盈亏（R 倍数）
  distanceToTp: number;      // 距离 TP 的百分比（正 = 盈利方向）
  distanceToSl: number;      // 距离 SL 的百分比（正 = 亏损方向）
};

// ── 仓位监控主函数 ───────────────────────────────────────────────────────────

/**
 * 监控所有 open 仓位，触及 TP/SL 时自动平仓。
 *
 * @param db             SQLite 数据库实例
 * @param client         交易所客户端（用于获取实时价格）
 * @param symbol         合约品种（如 "BTC/USDT:USDT"）
 * @param telegramConfig Telegram 配置（平仓时发送通知）
 * @param closedAt       平仓时间戳（测试时注入，生产环境用 Date.now()）
 */
export async function monitorPositions(
  db: Database.Database,
  client: ExchangeClient,
  symbol: string,
  telegramConfig?: TelegramConfig,
  closedAt: number = Date.now()
): Promise<MonitorResult> {
  const openPositions = getOpenPositions(db);

  if (openPositions.length === 0) {
    return { symbol, currentPrice: 0, checked: 0, closed: 0, closedRecords: [] };
  }

  // 获取当前价格
  let currentPrice: number;
  try {
    const ticker = await client.fetchTicker(symbol);
    currentPrice = ticker.last;
  } catch (err) {
    logger.warn({ symbol, err }, "monitorPositions: 获取价格失败，跳过本轮检查");
    return { symbol, currentPrice: 0, checked: openPositions.length, closed: 0, closedRecords: [] };
  }

  const closedRecords: ClosedPositionRecord[] = [];

  for (const pos of openPositions) {
    const hit = checkHit(pos, currentPrice);
    if (!hit) continue;

    const exitPrice = hit === "closed_tp" ? pos.takeProfit : pos.stopLoss;

    closePosition(
      db,
      pos.symbol,
      pos.direction,
      pos.timeframe,
      pos.entryHigh,
      exitPrice,
      hit,
      closedAt
    );

    const entryMid = (pos.entryLow + pos.entryHigh) / 2;
    const risk = Math.abs(entryMid - pos.stopLoss);
    const pnlR =
      risk > 0
        ? pos.direction === "long"
          ? (exitPrice - entryMid) / risk
          : (entryMid - exitPrice) / risk
        : 0;

    const record: ClosedPositionRecord = { position: pos, exitPrice, status: hit, pnlR };
    closedRecords.push(record);

    logger.info(
      { id: pos.id, status: hit, exitPrice, pnlR: pnlR.toFixed(2) },
      "模拟交易：仓位已平仓"
    );

    // 发送 Telegram 通知
    if (telegramConfig?.botToken && telegramConfig?.chatId) {
      const message = formatCloseMessage(record);
      await sendTelegramText(message, telegramConfig).catch((err) =>
        logger.warn({ err }, "平仓 Telegram 通知发送失败")
      );
    }
  }

  return {
    symbol,
    currentPrice,
    checked: openPositions.length,
    closed: closedRecords.length,
    closedRecords,
  };
}

// ── 未实现盈亏计算 ───────────────────────────────────────────────────────────

/**
 * 计算所有 open 仓位的当前未实现盈亏。
 * 供 dashboard / 日志展示使用，不触发平仓。
 */
export function getUnrealizedPnl(
  positions: OpenPosition[],
  currentPrice: number
): UnrealizedPosition[] {
  return positions.map((pos) => {
    const entryMid = (pos.entryLow + pos.entryHigh) / 2;
    const risk = Math.abs(entryMid - pos.stopLoss);

    const unrealizedPnlR =
      risk > 0
        ? pos.direction === "long"
          ? (currentPrice - entryMid) / risk
          : (entryMid - currentPrice) / risk
        : 0;

    const distanceToTp =
      pos.direction === "long"
        ? ((pos.takeProfit - currentPrice) / currentPrice) * 100
        : ((currentPrice - pos.takeProfit) / currentPrice) * 100;

    const distanceToSl =
      pos.direction === "long"
        ? ((currentPrice - pos.stopLoss) / currentPrice) * 100
        : ((pos.stopLoss - currentPrice) / currentPrice) * 100;

    return { position: pos, currentPrice, unrealizedPnlR, distanceToTp, distanceToSl };
  });
}

// ── 内部辅助 ──────────────────────────────────────────────────────────────────

/**
 * 判断仓位是否触及 TP 或 SL。
 * 同时触及（跳空行情）→ SL 优先（保守原则）。
 */
function checkHit(
  pos: OpenPosition,
  currentPrice: number
): "closed_tp" | "closed_sl" | null {
  if (pos.direction === "long") {
    const slHit = currentPrice <= pos.stopLoss;
    const tpHit = currentPrice >= pos.takeProfit;
    if (slHit) return "closed_sl";
    if (tpHit) return "closed_tp";
  } else {
    const slHit = currentPrice >= pos.stopLoss;
    const tpHit = currentPrice <= pos.takeProfit;
    if (slHit) return "closed_sl";
    if (tpHit) return "closed_tp";
  }
  return null;
}

function formatCloseMessage(record: ClosedPositionRecord): string {
  const { position: pos, exitPrice, status, pnlR } = record;
  const emoji = status === "closed_tp" ? "✅" : "🛑";
  const label = status === "closed_tp" ? "止盈" : "止损";
  const pnlSign = pnlR >= 0 ? "+" : "";

  return (
    `${emoji} *模拟交易 ${label}*\n` +
    `品种：${pos.symbol}  方向：${pos.direction === "long" ? "做多" : "做空"}\n` +
    `平仓价：${exitPrice.toLocaleString()}\n` +
    `盈亏：${pnlSign}${pnlR.toFixed(2)}R\n` +
    `持仓时长：${formatDuration(pos.openedAt, Date.now())}`
  );
}

async function sendTelegramText(text: string, config: TelegramConfig): Promise<void> {
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: config.chatId, text, parse_mode: "Markdown" }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Telegram HTTP ${res.status}: ${body || res.statusText}`);
  }
}

function formatDuration(openedAt: number, now: number): string {
  const ms = now - openedAt;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

import Database from "better-sqlite3";
import type { LiquiditySession } from "../../domain/market/market-context.js";
import type { NotificationConfig } from "../alerting/send-notification.js";
import { getOpenPositions } from "../positions/track-position.js";
import { env } from "../../app/env.js";
import { getOverallStats } from "../analytics/query-trade-report.js";
import { logger } from "../../app/logger.js";
import { hasNotificationChannel, sendTextNotification } from "../alerting/send-notification.js";

/**
 * 系统心跳通知  (PHASE_13)
 *
 * 职责：
 *   定期向通知通道推送系统运行状态摘要，让用户确认系统未崩溃。
 *   同时在终端打印相同摘要。
 *
 * 内容：
 *   - 版本 + 运行时长
 *   - 当前时间（UTC + 北京时间）
 *   - 当前交易时段
 *   - 持仓概况（open 数量，多/空分布）
 *   - 累计统计（总扫描、信号、胜率、总R）
 */

// ── 时段中文名映射 ─────────────────────────────────────────────────────────────

const SESSION_CN: Record<LiquiditySession, string> = {
  asian_low:          "🌏 亚洲盘",
  london_ramp:        "🇬🇧 欧洲盘启动",
  london_ny_overlap:  "🌐 伦敦/纽约重叠",
  ny_close:           "🇺🇸 美盘收盘区间",
};

// ── 主函数 ────────────────────────────────────────────────────────────────────

export type HeartbeatOptions = {
  version: string;
  startedAt: number;               // 进程启动时间戳（ms）
  currentSession: LiquiditySession | null;
};

/**
 * 发送一次心跳。
 * 同时打印终端日志 + 推送通知（notificationConfig 有效时）。
 */
export async function sendHeartbeat(
  db: Database.Database,
  notificationConfig: NotificationConfig,
  opts: HeartbeatOptions
): Promise<void> {
  const now = Date.now();
  const stats = getOverallStats(db);
  const openPositions = getOpenPositions(db, env.EXECUTION_MODE as "paper" | "live");

  const longCount  = openPositions.filter(p => p.direction === "long").length;
  const shortCount = openPositions.filter(p => p.direction === "short").length;
  const openCount  = openPositions.length;

  const uptimeMs = now - opts.startedAt;
  const uptimeStr = formatDuration(uptimeMs);

  const utcStr     = formatUtcTime(now);
  const beijingStr = formatBeijingTime(now);
  const sessionStr = opts.currentSession ? SESSION_CN[opts.currentSession] : "–";

  const winRateStr = stats.totalPositionsClosed > 0
    ? `${(stats.winRate * 100).toFixed(1)}%`
    : "–";
  const totalRStr  = stats.totalPositionsClosed > 0
    ? `${stats.totalR >= 0 ? "+" : ""}${stats.totalR.toFixed(2)}R`
    : "–";

  // ── 终端日志 ────────────────────────────────────────────────────────────────
  logger.info(
    {
      uptime: uptimeStr,
      session: opts.currentSession ?? "–",
      openPositions: openCount,
      totalScans: stats.totalScans,
      totalSignalsSent: stats.totalSignalsSent,
      totalPositionsClosed: stats.totalPositionsClosed,
      winRate: winRateStr,
      totalR: totalRStr,
    },
    "💓 Heartbeat"
  );

  // ── 通知推送 ────────────────────────────────────────────────────────────────
  if (!hasNotificationChannel(notificationConfig)) return;

  const text = formatHeartbeatMessage({
    version: opts.version,
    uptimeStr,
    utcStr,
    beijingStr,
    sessionStr,
    openCount,
    longCount,
    shortCount,
    totalScans: stats.totalScans,
    totalSignalsSent: stats.totalSignalsSent,
    totalPositionsClosed: stats.totalPositionsClosed,
    wins: stats.wins,
    winRateStr,
    totalRStr,
  });

  const result = await sendTextNotification(text, notificationConfig, fetch, {
    telegramParseMode: "Markdown",
  });
  if (!result.anyDelivered) {
    logger.warn({ channels: result }, "Heartbeat: 通知推送失败");
  }
}

// ── 内部辅助 ──────────────────────────────────────────────────────────────────

type MessageParams = {
  version: string;
  uptimeStr: string;
  utcStr: string;
  beijingStr: string;
  sessionStr: string;
  openCount: number;
  longCount: number;
  shortCount: number;
  totalScans: number;
  totalSignalsSent: number;
  totalPositionsClosed: number;
  wins: number;
  winRateStr: string;
  totalRStr: string;
};

function formatHeartbeatMessage(p: MessageParams): string {
  const posLine = p.openCount > 0
    ? `持仓 ${p.openCount} 笔（多 ${p.longCount} / 空 ${p.shortCount}）`
    : "当前无持仓";

  const statsLine = p.totalPositionsClosed > 0
    ? `已平仓 ${p.totalPositionsClosed} 笔  胜率 ${p.winRateStr}  总盈亏 ${p.totalRStr}`
    : "暂无已平仓记录";

  return (
    `💓 *Stratum 心跳* · v${p.version}\n` +
    `⏰ UTC ${p.utcStr}  |  北京 ${p.beijingStr}\n` +
    `⏱ 运行时长：${p.uptimeStr}\n` +
    `📍 当前时段：${p.sessionStr}\n` +
    `\n` +
    `📂 *持仓概况*\n` +
    `${posLine}\n` +
    `\n` +
    `📊 *累计统计*\n` +
    `扫描 ${p.totalScans} 次  |  发送信号 ${p.totalSignalsSent} 条\n` +
    `${statsLine}`
  );
}

function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function formatUtcTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return `${date} ${hh}:${mm}`;
}

function formatBeijingTime(ms: number): string {
  const beijingMs = ms + 8 * 60 * 60 * 1000;
  const d = new Date(beijingMs);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return `${date} ${hh}:${mm}`;
}

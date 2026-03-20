import type { LiquiditySession } from "../../domain/market/market-context.js";
import type { TelegramConfig } from "../alerting/send-alert.js";
import { getCurrentSession } from "../../utils/session.js";
import { logger } from "../../app/logger.js";

/**
 * 交易时段监控器  (PHASE_13)
 *
 * 职责：
 *   每次调用检测当前交易时段是否发生切换；
 *   若发生切换 → 同时在终端（logger.info）和 Telegram 推送提醒。
 *
 * 状态管理：
 *   lastSession 由调用方持有（index.ts 闭包），此函数本身无状态。
 *   第一次调用（lastSession = null）→ 初始化，不发送通知。
 *
 * 时段划分（UTC）：
 *   asian_low         22:00 – 06:00  → 北京 06:00 – 14:00
 *   london_ramp       06:00 – 08:00  → 北京 14:00 – 16:00
 *   london_ny_overlap 08:00 – 16:00  → 北京 16:00 – 00:00
 *   ny_close          16:00 – 22:00  → 北京 00:00 – 06:00
 */

// ── 时段元信息 ─────────────────────────────────────────────────────────────────

type SessionMeta = {
  emoji: string;
  nameCn: string;       // 中文名称
  openUtc: string;      // 开盘 UTC 时间
  openBeijing: string;  // 开盘北京时间
  closeUtc: string;     // 收盘 UTC 时间
  closeBeijing: string; // 收盘北京时间
  note: string;         // 交易特征说明
};

const SESSION_META: Record<LiquiditySession, SessionMeta> = {
  asian_low: {
    emoji: "🌏",
    nameCn: "亚洲盘",
    openUtc: "22:00",
    openBeijing: "06:00",
    closeUtc: "06:00",
    closeBeijing: "14:00",
    note: "流动性偏低，信号评分折扣 20%，警惕假突破",
  },
  london_ramp: {
    emoji: "🇬🇧",
    nameCn: "欧洲盘启动",
    openUtc: "06:00",
    openBeijing: "14:00",
    closeUtc: "08:00",
    closeBeijing: "16:00",
    note: "欧盘开启，流动性上升，信号评分溢价 10%，关注欧盘方向",
  },
  london_ny_overlap: {
    emoji: "🌐",
    nameCn: "伦敦/纽约重叠",
    openUtc: "08:00",
    openBeijing: "16:00",
    closeUtc: "16:00",
    closeBeijing: "00:00（次日）",
    note: "主力时段，流动性最强，大行情高发期，信号可信度最高",
  },
  ny_close: {
    emoji: "🇺🇸",
    nameCn: "美盘收盘区间",
    openUtc: "16:00",
    openBeijing: "00:00",
    closeUtc: "22:00",
    closeBeijing: "06:00",
    note: "美盘尾段，关注收盘前方向性突破，流动性逐步回落",
  },
};

// ── 主函数 ────────────────────────────────────────────────────────────────────

/**
 * 检测时段变化，发生切换时推送终端 + Telegram 通知。
 *
 * @param lastSession  上一次记录的时段（null = 首次调用，仅初始化）
 * @param telegramConfig  Telegram 配置（可选，未配置则仅打印终端日志）
 * @returns 当前时段（供下次调用时传入作为 lastSession）
 */
export async function monitorSession(
  lastSession: LiquiditySession | null,
  telegramConfig?: TelegramConfig
): Promise<LiquiditySession> {
  const currentSession = getCurrentSession();

  // 首次调用：静默初始化，不发送通知
  if (lastSession === null) {
    const meta = SESSION_META[currentSession];
    logger.info(
      { session: currentSession, nameCn: meta.nameCn },
      "Session monitor: 初始化当前时段"
    );
    return currentSession;
  }

  // 时段未变化
  if (currentSession === lastSession) {
    return currentSession;
  }

  // ── 时段切换：发送通知 ───────────────────────────────────────────────────
  const meta = SESSION_META[currentSession];
  const prevMeta = SESSION_META[lastSession];

  // 1. 终端日志
  logger.info(
    {
      from: lastSession,
      to: currentSession,
      fromCn: prevMeta.nameCn,
      toCn: meta.nameCn,
      openUtc: meta.openUtc,
      openBeijing: meta.openBeijing,
    },
    `Session: ${prevMeta.nameCn} → ${meta.nameCn}`
  );

  // 2. Telegram 消息
  if (telegramConfig?.botToken && telegramConfig?.chatId) {
    const message = formatSessionMessage(meta);
    await sendTelegramText(message, telegramConfig).catch((err) => {
      logger.warn({ err }, "Session monitor: Telegram 推送失败");
    });
  }

  return currentSession;
}

// ── 内部辅助 ──────────────────────────────────────────────────────────────────

function formatSessionMessage(meta: SessionMeta): string {
  return (
    `${meta.emoji} *${meta.nameCn} 开启*\n` +
    `⏰ UTC ${meta.openUtc}  |  北京 ${meta.openBeijing}\n` +
    `🔚 收盘：UTC ${meta.closeUtc}  |  北京 ${meta.closeBeijing}\n` +
    `📊 ${meta.note}`
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
    throw new Error(`Telegram API ${res.status}: ${await res.text()}`);
  }
}

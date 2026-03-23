import { env } from "./app/env.js";
import { logger } from "./app/logger.js";
import { CcxtClient } from "./clients/exchange/ccxt-client.js";
import { createLlmClient } from "./clients/llm/llm-client.js";
import { openDb } from "./services/persistence/init-db.js";
import { runSignalScan } from "./services/orchestrator/run-signal-scan.js";
import { runScheduler } from "./services/scheduler/run-scheduler.js";
import { fetchNews } from "./services/macro/fetch-news.js";
import { monitorPositions } from "./services/paper-trading/monitor-positions.js";
import { monitorSession } from "./services/session/monitor-session.js";
import { sendHeartbeat } from "./services/system/send-heartbeat.js";
import type { LiquiditySession } from "./domain/market/market-context.js";
import type { NotificationConfig } from "./services/alerting/send-notification.js";
import { startDiscordBot } from "./services/discord/discord-bot.js";
import { getOpenPositions } from "./services/positions/track-position.js";
import { startTelegramCommandBot } from "./services/telegram/telegram-command-bot.js";

/**
 * Stratum 入口  (PHASE_13)
 *
 * 四调度器架构：
 *   1. 信号扫描器（每 4h UTC 边界 + 30s 缓冲）
 *      检测结构信号 → 宏观过滤 → 发送通知 → 开模拟仓位
 *   2. 仓位监控器（每 30s）
 *      获取实时价格 → 检查 TP/SL → 自动平仓 → 发送通知
 *   3. 时段监控器（每 60s）
 *      检测交易时段切换 → 终端日志 + 通知
 *   4. 心跳通知器（默认每 6h，可通过 HEARTBEAT_INTERVAL_H 配置）
 *      推送系统运行状态：运行时长 / 持仓概况 / 累计统计
 *
 * 必填环境变量:
 *   TELEGRAM_BOT_TOKEN   - Telegram Bot Token（可选）
 *   TELEGRAM_CHAT_ID     - Telegram Chat ID（可选）
 *   TELEGRAM_COMMAND_BOT_ENABLED - 是否启用 Telegram 命令机器人（可选，默认 false）
 *   DISCORD_WEBHOOK_URL  - Discord Incoming Webhook（可选）
 *   DISCORD_BOT_ENABLED  - 是否启用 Discord Bot 交互（可选，默认 false）
 *   DISCORD_BOT_TOKEN    - Discord Bot Token（交互模式，可选）
 *   DISCORD_APPLICATION_ID - Discord Application ID（交互模式，可选）
 *   DISCORD_GUILD_ID     - Discord Guild ID（交互模式，可选）
 *
 * 选填环境变量:
 *   SYMBOL              - 合约品种（默认: BTC/USDT:USDT）
 *   SPOT_SYMBOL         - 现货品种（默认: BTC/USDT）
 *   NEWS_API_KEY        - NewsAPI Key（不填则跳过新闻）
 *   LLM_API_KEY         - LLM API Key（Anthropic 或 OpenRouter，不填则跳过宏观分析）
 *   LLM_PROVIDER        - "anthropic" | "openrouter"（默认: anthropic）
 *   LLM_MODEL           - 模型名称（可选，不填则使用 provider 默认值）
 *   DATABASE_URL        - SQLite 路径（默认: ./stratum.db）
 *   ACCOUNT_SIZE        - 账户规模 USD（默认: 10000）
 *   RISK_PER_TRADE      - 单笔风险比例（默认: 0.01 = 1%）
 */

const VERSION = "0.13.0";
const STARTED_AT = Date.now();
logger.info({ version: VERSION }, "Stratum starting");

const client = new CcxtClient(env.EXCHANGE_NAME, env.SPOT_SYMBOL);
const db = openDb(env.DATABASE_URL);

// 用于优雅停机的 AbortController
const shutdownController = new AbortController();
const shutdown = (sig: string) => {
  logger.info({ sig }, "Stratum: shutdown signal received");
  shutdownController.abort();
};
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

// LLM 客户端（支持 anthropic / openrouter，LLM_API_KEY 未设置时为 no-op）
const llmCall = createLlmClient({
  apiKey: env.LLM_API_KEY,
  provider: env.LLM_PROVIDER,
  model: env.LLM_MODEL,
});

async function main(): Promise<void> {
  let lastSession: LiquiditySession | null = null;
  let lastScanAt: number | null = null;

  const notificationConfig: NotificationConfig = {
    telegram: env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID
      ? {
          botToken: env.TELEGRAM_BOT_TOKEN,
          chatId: env.TELEGRAM_CHAT_ID,
        }
      : undefined,
    discord: env.DISCORD_WEBHOOK_URL
      ? {
          webhookUrl: env.DISCORD_WEBHOOK_URL,
        }
      : undefined,
  };

  if (!notificationConfig.telegram && !notificationConfig.discord) {
    logger.warn(
      "No notification channel configured — alerts will be silently dropped"
    );
  }

  const perpSymbol = env.SYMBOL.replace("/", "").replace(":USDT", ""); // "BTC/USDT:USDT" → "BTCUSDT"

  const scanDeps = {
    client,
    db,
    llmCall,
    notificationConfig,
    newsApiKey: env.NEWS_API_KEY ?? "",
    fetchNewsFn: fetchNews,
  };

  let stopDiscordBot: (() => Promise<void>) | null = null;
  let stopTelegramCommandBot: (() => void) | null = null;

  if (env.TELEGRAM_COMMAND_BOT_ENABLED) {
    if (!env.TELEGRAM_BOT_TOKEN) {
      logger.warn("TELEGRAM_COMMAND_BOT_ENABLED=true but TELEGRAM_BOT_TOKEN is missing");
    } else {
      const handle = startTelegramCommandBot(
        {
          token: env.TELEGRAM_BOT_TOKEN,
          allowedChatId: env.TELEGRAM_CHAT_ID,
          version: VERSION,
          startedAt: STARTED_AT,
          symbol: env.SYMBOL,
          spotSymbol: env.SPOT_SYMBOL,
          getLastScanAt: () => lastScanAt,
          getCurrentSession: () => lastSession,
          getOpenPositions: () => getOpenPositions(db),
          fetchTotalEquity: async () => {
            const bal = await client.fetchBalance();
            return bal.totalEquity;
          },
          fetchAvailableMargin: async () => {
            const bal = await client.fetchBalance();
            return bal.availableMargin;
          },
          fetchPerpPrice: async (symbol: string) => {
            const ticker = await client.fetchTicker(symbol);
            return ticker.last;
          },
          fetchSpotPrice: async (symbol: string) => {
            const ticker = await client.fetchSpotTicker(symbol);
            return ticker.last;
          },
        },
        shutdownController.signal
      );
      stopTelegramCommandBot = handle.stop;
    }
  }

  if (env.DISCORD_BOT_ENABLED) {
    if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_APPLICATION_ID || !env.DISCORD_GUILD_ID) {
      logger.warn(
        "DISCORD_BOT_ENABLED=true but DISCORD_BOT_TOKEN / DISCORD_APPLICATION_ID / DISCORD_GUILD_ID is missing"
      );
    } else {
      const handle = await startDiscordBot({
        token: env.DISCORD_BOT_TOKEN,
        applicationId: env.DISCORD_APPLICATION_ID,
        guildId: env.DISCORD_GUILD_ID,
        version: VERSION,
        startedAt: STARTED_AT,
        symbol: env.SYMBOL,
        spotSymbol: env.SPOT_SYMBOL,
        getLastScanAt: () => lastScanAt,
        getCurrentSession: () => lastSession,
        getOpenPositions: () => getOpenPositions(db),
        fetchTotalEquity: async () => {
          const bal = await client.fetchBalance();
          return bal.totalEquity;
        },
        fetchAvailableMargin: async () => {
          const bal = await client.fetchBalance();
          return bal.availableMargin;
        },
        fetchPerpPrice: async (symbol: string) => {          const ticker = await client.fetchTicker(symbol);
          return ticker.last;
        },
        fetchSpotPrice: async (symbol: string) => {
          const ticker = await client.fetchSpotTicker(symbol);
          return ticker.last;
        },
      });
      stopDiscordBot = handle.stop;
    }
  }

  // ── 调度器 1：信号扫描（每 4h UTC 边界）───────────────────────────────────
  const signalScheduler = runScheduler(
    async () => {
      const result = await runSignalScan(perpSymbol, env.SPOT_SYMBOL, scanDeps);
      lastScanAt = result.scannedAt;
      return result;
    },
    {
      intervalMs: 4 * 60 * 60 * 1000, // 4h
      bufferMs: 30_000,               // 4h 收盘后 30s 缓冲
      alignToInterval: true,          // 对齐 UTC 0/4/8/12/16/20 点
      immediate: true,                // 启动时立即扫描一次
    },
    shutdownController.signal
  );

  // ── 调度器 2：仓位监控（每 30s，模拟交易 TP/SL 检测）──────────────────────
  const positionMonitor = runScheduler(
    async () => {
      const result = await monitorPositions(db, client, env.SYMBOL, notificationConfig);
      if (result.closed > 0) {
        logger.info(
          { closed: result.closed, currentPrice: result.currentPrice },
          "模拟交易：本轮平仓完成"
        );
      } else {
        logger.debug(
          { checked: result.checked, currentPrice: result.currentPrice },
          "模拟交易：仓位检查完成，无触发"
        );
      }
    },
    {
      intervalMs: 30_000,            // 每 30 秒检查一次
      alignToInterval: false,
      immediate: false,              // 等待第一个信号后再监控
    },
    shutdownController.signal
  );

  // ── 调度器 3：交易时段监控（每 60s 检测时段切换）─────────────────────────
  const sessionMonitor = runScheduler(
    async () => {
      lastSession = await monitorSession(lastSession, notificationConfig);
    },
    {
      intervalMs: 60_000,            // 每 60 秒检查一次
      alignToInterval: false,
      immediate: true,               // 启动时立即初始化当前时段
    },
    shutdownController.signal
  );

  // ── 调度器 4：心跳通知（每 N 小时推送系统状态摘要）──────────────────────────
  const heartbeatIntervalMs = env.HEARTBEAT_INTERVAL_H * 60 * 60 * 1000;
  const heartbeatScheduler = runScheduler(
    async () => {
      await sendHeartbeat(db, notificationConfig, {
        version: VERSION,
        startedAt: STARTED_AT,
        currentSession: lastSession,
      });
    },
    {
      intervalMs: heartbeatIntervalMs,   // 默认 6h，可通过 HEARTBEAT_INTERVAL_H 配置
      alignToInterval: false,
      immediate: false,                  // 启动时不发，等第一个间隔到期再发
    },
    shutdownController.signal
  );

  await Promise.all([signalScheduler, positionMonitor, sessionMonitor, heartbeatScheduler]);
  if (stopTelegramCommandBot) {
    stopTelegramCommandBot();
  }
  if (stopDiscordBot) {
    await stopDiscordBot();
  }

  logger.info("Stratum: 所有调度器已退出（信号扫描 / 仓位监控 / 时段监控）");
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "Stratum crashed");
  process.exit(1);
});

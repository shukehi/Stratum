import { env } from "./app/env.js";
import { logger } from "./app/logger.js";
import { CcxtClient } from "./clients/exchange/ccxt-client.js";
import { createLlmClient } from "./clients/llm/llm-client.js";
import { openDb } from "./services/persistence/init-db.js";
import { runSignalScan } from "./services/orchestrator/run-signal-scan.js";
import { runScheduler } from "./services/scheduler/run-scheduler.js";
import { fetchNews } from "./services/macro/fetch-news.js";
import { monitorPositions } from "./services/paper-trading/monitor-positions.js";

/**
 * Stratum 入口  (PHASE_11)
 *
 * 双调度器架构：
 *   1. 信号扫描器（每 4h UTC 边界 + 30s 缓冲）
 *      检测结构信号 → 宏观过滤 → 发送 Telegram → 开模拟仓位
 *   2. 仓位监控器（每 30s）
 *      获取实时价格 → 检查 TP/SL → 自动平仓 → 发送 Telegram 通知
 *
 * 必填环境变量:
 *   TELEGRAM_BOT_TOKEN  - Telegram Bot Token
 *   TELEGRAM_CHAT_ID    - Telegram Chat ID
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

logger.info({ version: "0.11.0" }, "Stratum starting");

const client = new CcxtClient(env.EXCHANGE_NAME, env.SPOT_SYMBOL);
const db = openDb(env.DATABASE_URL);

// グレースフルシャットダウン用 AbortController
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
  const telegramConfig = {
    botToken: env.TELEGRAM_BOT_TOKEN ?? "",
    chatId: env.TELEGRAM_CHAT_ID ?? "",
  };

  if (!telegramConfig.botToken || !telegramConfig.chatId) {
    logger.warn(
      "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set — alerts will be silently dropped"
    );
  }

  const perpSymbol = env.SYMBOL.replace("/", "").replace(":USDT", ""); // "BTC/USDT:USDT" → "BTCUSDT"

  const scanDeps = {
    client,
    db,
    llmCall,
    telegramConfig,
    newsApiKey: env.NEWS_API_KEY ?? "",
    fetchNewsFn: fetchNews,
  };

  // ── 调度器 1：信号扫描（每 4h UTC 边界）───────────────────────────────────
  const signalScheduler = runScheduler(
    () => runSignalScan(perpSymbol, env.SPOT_SYMBOL, scanDeps),
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
      const result = await monitorPositions(db, client, env.SYMBOL, telegramConfig);
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

  await Promise.all([signalScheduler, positionMonitor]);

  logger.info("Stratum: 所有调度器已退出");
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "Stratum crashed");
  process.exit(1);
});

import { env } from "./app/env.js";
import { logger } from "./app/logger.js";
import { CcxtClient } from "./clients/exchange/ccxt-client.js";
import { openDb } from "./services/persistence/init-db.js";
import { runSignalScan } from "./services/orchestrator/run-signal-scan.js";
import { runScheduler } from "./services/scheduler/run-scheduler.js";
import { fetchNews } from "./services/macro/fetch-news.js";

/**
 * Stratum エントリポイント  (PHASE_10-A)
 *
 * 環境変数から設定を読み込み、4h ローソク足クローズに合わせてシグナルスキャンを
 * 定期実行する。SIGTERM / SIGINT でグレースフルシャットダウン。
 *
 * 必須環境変数:
 *   TELEGRAM_BOT_TOKEN  - Telegram Bot トークン
 *   TELEGRAM_CHAT_ID    - Telegram チャット ID
 *
 * 任意環境変数:
 *   SYMBOL              - 先物シンボル（デフォルト: BTC/USDT:USDT）
 *   SPOT_SYMBOL         - スポットシンボル（デフォルト: BTC/USDT）
 *   NEWS_API_KEY        - NewsAPI キー（省略時: マクロニュースなし）
 *   LLM_API_KEY         - LLM API キー（省略時: マクロ評価スキップ → pass）
 *   DATABASE_URL        - SQLite パス（デフォルト: ./stratum.db）
 *   ACCOUNT_SIZE        - 口座サイズ USD（ポジションサイズ計算用）
 */

logger.info({ version: "0.10.0" }, "Stratum starting");

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

/**
 * LLM 呼び出し関数（Anthropic Messages API 互換）
 * LLM_API_KEY が未設定の場合は空文字を返す
 * （assess-macro-overlay が confidenceScore=0 → pass にフォールバック）
 */
async function makeLlmCall(prompt: string): Promise<string> {
  if (!env.LLM_API_KEY) {
    logger.debug("LLM_API_KEY not set, skipping macro LLM call");
    return "";
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.LLM_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-haiku-20240307",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API HTTP ${res.status}: ${res.statusText}`);
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; text: string }>;
  };
  return data.content.find((c) => c.type === "text")?.text ?? "";
}

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
    llmCall: makeLlmCall,
    telegramConfig,
    newsApiKey: env.NEWS_API_KEY ?? "",
    fetchNewsFn: fetchNews,
  };

  await runScheduler(
    () => runSignalScan(perpSymbol, env.SPOT_SYMBOL, scanDeps),
    {
      intervalMs: 4 * 60 * 60 * 1000, // 4h
      bufferMs: 30_000,               // 30s post-candle close buffer
      alignToInterval: true,          // align to UTC 0/4/8/12/16/20h
      immediate: true,                // run once on startup
    },
    shutdownController.signal
  );

  logger.info("Stratum: scheduler exited cleanly");
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "Stratum crashed");
  process.exit(1);
});

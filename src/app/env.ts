import { z } from "zod";

const EnvSchema = z.object({
  EXCHANGE_NAME: z.string().default("binance"),
  SYMBOL: z.string().default("BTC/USDT:USDT"),
  SPOT_SYMBOL: z.string().default("BTC/USDT"),
  NEWS_API_KEY: z.string().optional(),
  // LLM 配置
  LLM_API_KEY: z.string().optional(),
  LLM_PROVIDER: z.enum(["anthropic", "openrouter"]).default("anthropic"),
  LLM_MODEL: z.string().optional(), // 不填则按 provider 使用默认模型
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  DATABASE_URL: z.string().default("./stratum.db"),
  ACCOUNT_SIZE: z.coerce.number().positive().default(10000),
  RISK_PER_TRADE: z.coerce.number().positive().max(0.05).default(0.01),
  HEARTBEAT_INTERVAL_H: z.coerce.number().positive().default(6), // 心跳间隔（小时），默认 6h
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    console.error("❌ 环境变量校验失败：");
    console.error(result.error.flatten().fieldErrors);
    process.exit(1);
  }
  return result.data;
}

export const env = loadEnv();

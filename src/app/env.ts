import { z } from "zod";

const EnvSchema = z.object({
  EXCHANGE_NAME: z.string().trim().default("binanceusdm"),
  EXECUTION_MODE: z.enum(["paper", "live"]).default("paper"),
  EXCHANGE_API_KEY: z.string().trim().optional(),
  EXCHANGE_SECRET: z.string().trim().optional(),
  SYMBOL: z.string().trim().default("BTC/USDT:USDT"),
  SPOT_SYMBOL: z.string().trim().default("BTC/USDT"),
  TELEGRAM_BOT_TOKEN: z.string().trim().optional(),
  TELEGRAM_CHAT_ID: z.string().trim().optional(),
  TELEGRAM_COMMAND_BOT_ENABLED: z.enum(["true", "false"]).default("false"),
  DISCORD_WEBHOOK_URL: z.string().trim().url().optional(),
  // Discord Bot 配置（用于 slash commands / 交互式 bot）
  DISCORD_BOT_ENABLED: z.enum(["true", "false"]).default("false"),
  DISCORD_BOT_TOKEN: z.string().trim().optional(),
  DISCORD_APPLICATION_ID: z.string().trim().optional(),
  DISCORD_GUILD_ID: z.string().trim().optional(),
  DATABASE_URL: z.string().trim().default("./stratum.db"),
  ACCOUNT_SIZE: z.coerce.number().positive().default(10000),
  RISK_PER_TRADE: z.coerce.number().positive().max(0.05).default(0.01),
  HEARTBEAT_INTERVAL_H: z.coerce.number().positive().default(6), // 心跳间隔（小时），默认 6h
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

type EnvInput = z.infer<typeof EnvSchema>;
export type Env = Omit<EnvInput, "DISCORD_BOT_ENABLED" | "TELEGRAM_COMMAND_BOT_ENABLED"> & {
  DISCORD_BOT_ENABLED: boolean;
  TELEGRAM_COMMAND_BOT_ENABLED: boolean;
};

function loadEnv(): Env {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    console.error("❌ 环境变量校验失败：");
    console.error(result.error.flatten().fieldErrors);
    process.exit(1);
  }
  return {
    ...result.data,
    DISCORD_BOT_ENABLED: result.data.DISCORD_BOT_ENABLED === "true",
    TELEGRAM_COMMAND_BOT_ENABLED: result.data.TELEGRAM_COMMAND_BOT_ENABLED === "true",
  };
}

export const env = loadEnv();

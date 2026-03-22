import pino from "pino";
import { env } from "./env.js";

/**
 * 全局日志实例。
 *
 * 开发环境使用 `pino-pretty` 便于终端阅读，生产环境保持结构化 JSON，
 * 方便后续接入日志采集或机器分析。
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  transport:
    env.NODE_ENV !== "production"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});

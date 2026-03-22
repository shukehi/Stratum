import { logger } from "../app/logger.js";

/**
 * 指数退避重试包装器。
 *
 * 适用于外部 IO 调用：首次失败后按 delayMs、2*delayMs、4*delayMs...
 * 的节奏重试，最终仍失败则抛出最后一次错误。
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  delayMs: number = 1000
): Promise<T> {
  if (maxAttempts <= 0) {
    throw new Error(`withRetry: maxAttempts must be > 0, got ${maxAttempts}`);
  }
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxAttempts - 1) {
        // 使用指数退避降低连续失败时对外部服务造成的额外压力。
        const wait = delayMs * Math.pow(2, attempt);
        logger.warn({ attempt, wait, error: lastError.message }, "Retrying after error");
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
  }
  throw lastError;
}

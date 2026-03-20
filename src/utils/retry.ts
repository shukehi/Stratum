import { logger } from "../app/logger.js";

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
        const wait = delayMs * Math.pow(2, attempt);
        logger.warn({ attempt, wait, error: lastError.message }, "Retrying after error");
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
  }
  throw lastError;
}

import { logger } from "../../app/logger.js";

/**
 * 调度器  (PHASE_10-A)
 *
 * 设计原则：
 *   - 对齐 4h K 线收盘边界执行扫描，保证使用的是最新已确认数据；
 *   - 通过 `AbortSignal` 支持优雅停机，让进行中的扫描先跑完；
 *   - 单次扫描失败只记录日志，不导致进程崩溃；
 *   - `scanFn` 外部注入，因此调度器本身不依赖具体基础设施。
 *
 * 使用示例（见 `src/index.ts`）：
 *   `const controller = new AbortController();`
 *   `process.on("SIGTERM", () => controller.abort());`
 *   `await runScheduler(() => runSignalScan(...), {}, controller.signal);`
 */

export type SchedulerOptions = {
  /**
   * 扫描间隔（毫秒）。
   * 当 `alignToInterval=true` 时，该值也作为边界对齐基准。
   * 默认 4h（14_400_000ms）。
   */
  intervalMs?: number;
  /**
   * K 线收盘后的缓冲时间（毫秒），用于吸收交易所落盘延迟。
   * 默认 30_000ms（30 秒）。
   */
  bufferMs?: number;
  /**
   * 为 `true` 时按固定边界对齐扫描；为 `false` 时按固定间隔轮询。
   * 默认 `true`。
   */
  alignToInterval?: boolean;
  /**
   * 为 `true` 时进程启动后立即先执行一次扫描。
   * 默认 `true`。
   */
  immediate?: boolean;
};

// ── 对外辅助函数（纯函数，便于测试）────────────────────────────────────────

/**
 * 计算距离下一个调度边界还需等待多少毫秒（纯函数）。
 *
 * 例：`intervalMs=4h`、`bufferMs=30s`
 *   `nowMs` 恰好落在边界上  → `intervalMs + bufferMs`
 *   `nowMs` 比边界晚 1 小时 → `3h + bufferMs`
 *   `nowMs` 距离边界差 1ms  → `1 + bufferMs`
 */
export function msUntilNextBoundary(
  nowMs: number,
  intervalMs: number,
  bufferMs: number
): number {
  const msIntoInterval = nowMs % intervalMs;
  // 若当前时间恰好落在边界上，则等待到下一个完整周期，避免重复扫描
  const msUntilClose =
    msIntoInterval === 0 ? intervalMs : intervalMs - msIntoInterval;
  return msUntilClose + bufferMs;
}

// ── 主调度器 ────────────────────────────────────────────────────────────────

export async function runScheduler(
  scanFn: () => Promise<unknown>,
  options: SchedulerOptions = {},
  signal?: AbortSignal
): Promise<void> {
  const {
    intervalMs = 4 * 60 * 60 * 1000, // 4h
    bufferMs = 30_000,                // 30s
    alignToInterval = true,
    immediate = true,
  } = options;

  logger.info(
    { intervalMs, bufferMs, alignToInterval, immediate },
    "Scheduler: starting"
  );

  // 启动后立即扫描一次
  if (immediate && !signal?.aborted) {
    await executeScan(scanFn);
  }

  // 调度循环：持续运行直到收到 abort 信号
  while (!signal?.aborted) {
    const delay = alignToInterval
      ? msUntilNextBoundary(Date.now(), intervalMs, bufferMs)
      : intervalMs;

    const nextAt = new Date(Date.now() + delay).toISOString();
    logger.info(
      { delaySeconds: Math.round(delay / 1000), nextAt },
      "Scheduler: next scan scheduled"
    );

    const aborted = await sleep(delay, signal);
    if (aborted) break;

    if (!signal?.aborted) {
      await executeScan(scanFn);
    }
  }

  logger.info("Scheduler: shutdown complete");
}

// ── 内部辅助 ────────────────────────────────────────────────────────────────

async function executeScan(
  scanFn: () => Promise<unknown>
): Promise<void> {
  logger.info("Scheduler: executing scan");
  try {
    await scanFn();
    logger.info("Scheduler: scan complete");
  } catch (err) {
    logger.error(
      { err },
      "Scheduler: scan failed, will retry at next interval"
    );
  }
}

/**
 * 休眠指定毫秒数；若 `AbortSignal` 触发则立即结束等待。
 *
 * @returns 若因 abort 提前结束则返回 `true`，否则返回 `false`
 */
function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve(true);
        },
        { once: true }
      );
    }
  });
}

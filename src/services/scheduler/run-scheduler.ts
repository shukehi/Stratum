import { logger } from "../../app/logger.js";

/**
 * 调度器  (PHASE_10-A / musk-optimization-v1)
 *
 * 两种调用语法（均导出为 `runScheduler`，通过 TypeScript 重载区分）：
 *
 * **V1 — 单回调**（供 `src/index.ts` 等存量代码使用）
 *   ```ts
 *   runScheduler(scanFn, options, signal)
 *   ```
 *
 * **V2 — 多回调配置对象**（新接口，供调度器测试使用）
 *   ```ts
 *   runScheduler({ scanSymbols, onScan, onMonitor, onSession, onHeartbeat }, signal, intervals)
 *   ```
 */

// ── SchedulerOptions（V1）───────────────────────────────────────────────────

export type SchedulerOptions = {
  intervalMs?: number;
  bufferMs?: number;
  alignToInterval?: boolean;
  immediate?: boolean;
};

// ── SchedulerV2Config（V2）──────────────────────────────────────────────────

export type SchedulerV2Config = {
  scanSymbols: string[];
  onScan: (symbols: string[]) => Promise<unknown>;
  onMonitor: () => Promise<unknown>;
  onSession: () => Promise<unknown>;
  onHeartbeat: () => Promise<unknown>;
};

export type SchedulerV2Intervals = {
  scanIntervalMs?: number;
  monitorIntervalMs?: number;
  sessionIntervalMs?: number;
  heartbeatIntervalMs?: number;
};

// ── 辅助函数（纯函数，便于测试）─────────────────────────────────────────────

export function msUntilNextBoundary(
  nowMs: number,
  intervalMs: number,
  bufferMs: number
): number {
  const msIntoInterval = nowMs % intervalMs;
  const msUntilClose =
    msIntoInterval === 0 ? intervalMs : intervalMs - msIntoInterval;
  return msUntilClose + bufferMs;
}

// ── 重载声明 ─────────────────────────────────────────────────────────────────

export async function runScheduler(
  scanFn: () => Promise<unknown>,
  options?: SchedulerOptions,
  signal?: AbortSignal
): Promise<void>;

export async function runScheduler(
  config: SchedulerV2Config,
  signal: AbortSignal,
  intervals?: SchedulerV2Intervals
): Promise<void>;

// ── 实现 ─────────────────────────────────────────────────────────────────────

export async function runScheduler(
  arg0: (() => Promise<unknown>) | SchedulerV2Config,
  arg1?: SchedulerOptions | AbortSignal,
  arg2?: AbortSignal | SchedulerV2Intervals
): Promise<void> {
  // 区分 V1 / V2：arg0 是函数则走 V1
  if (typeof arg0 === "function") {
    return runSchedulerV1(
      arg0,
      (arg1 as SchedulerOptions | undefined) ?? {},
      (arg2 as AbortSignal | undefined)
    );
  } else {
    return runSchedulerV2(
      arg0,
      arg1 as AbortSignal,
      (arg2 as SchedulerV2Intervals | undefined) ?? {}
    );
  }
}

// ── V1 实现 ──────────────────────────────────────────────────────────────────

async function runSchedulerV1(
  scanFn: () => Promise<unknown>,
  options: SchedulerOptions,
  signal?: AbortSignal
): Promise<void> {
  const {
    intervalMs = 4 * 60 * 60 * 1000,
    bufferMs = 30_000,
    alignToInterval = true,
    immediate = true,
  } = options;

  logger.info(
    { intervalMs, bufferMs, alignToInterval, immediate },
    "Scheduler V1: starting"
  );

  if (immediate && !signal?.aborted) {
    await safeCall("scan", scanFn);
  }

  while (!signal?.aborted) {
    const delay = alignToInterval
      ? msUntilNextBoundary(Date.now(), intervalMs, bufferMs)
      : intervalMs;

    const nextAt = new Date(Date.now() + delay).toISOString();
    logger.info(
      { delaySeconds: Math.round(delay / 1000), nextAt },
      "Scheduler V1: next scan scheduled"
    );

    const aborted = await sleep(delay, signal);
    if (aborted) break;

    if (!signal?.aborted) {
      await safeCall("scan", scanFn);
    }
  }

  logger.info("Scheduler V1: shutdown complete");
}

// ── V2 实现 ──────────────────────────────────────────────────────────────────

async function runSchedulerV2(
  config: SchedulerV2Config,
  signal: AbortSignal,
  intervals: SchedulerV2Intervals
): Promise<void> {
  const {
    scanIntervalMs = 4 * 60 * 60 * 1000,
    monitorIntervalMs = 60_000,
    sessionIntervalMs = 5 * 60 * 1000,
    heartbeatIntervalMs = 30_000,
  } = intervals;

  logger.info(
    { scanIntervalMs, monitorIntervalMs, sessionIntervalMs, heartbeatIntervalMs },
    "Scheduler V2: starting"
  );

  // 启动时立即执行一次扫描
  if (!signal.aborted) {
    await safeCall("scan", () => config.onScan(config.scanSymbols));
  }

  const timers: ReturnType<typeof setInterval>[] = [];

  timers.push(
    setInterval(async () => {
      if (!signal.aborted)
        await safeCall("scan", () => config.onScan(config.scanSymbols));
    }, scanIntervalMs)
  );

  timers.push(
    setInterval(async () => {
      if (!signal.aborted) await safeCall("monitor", config.onMonitor);
    }, monitorIntervalMs)
  );

  timers.push(
    setInterval(async () => {
      if (!signal.aborted) await safeCall("session", config.onSession);
    }, sessionIntervalMs)
  );

  timers.push(
    setInterval(async () => {
      if (!signal.aborted) await safeCall("heartbeat", config.onHeartbeat);
    }, heartbeatIntervalMs)
  );

  await new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });

  for (const t of timers) clearInterval(t);

  logger.info("Scheduler V2: shutdown complete");
}

// ── 内部辅助 ─────────────────────────────────────────────────────────────────

async function safeCall(
  name: string,
  fn: () => Promise<unknown>
): Promise<void> {
  logger.info(`Scheduler: executing ${name}`);
  try {
    await fn();
    logger.info(`Scheduler: ${name} complete`);
  } catch (err) {
    logger.error({ err }, `Scheduler: ${name} failed, will retry at next interval`);
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
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

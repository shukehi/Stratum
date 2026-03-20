import { logger } from "../../app/logger.js";

/**
 * スケジューラ  (PHASE_10-A)
 *
 * 設計方針（第一性原理）:
 *   - 4h ローソク足クローズ境界（UTC 00:00 / 04:00 / 08:00 / 12:00 / 16:00 / 20:00）
 *     に合わせてスキャンを実行することで、最新の確定足データを使う。
 *   - AbortSignal によるグレースフルシャットダウン: 進行中のスキャンは完走させてから終了。
 *   - スキャン失敗はクラッシュしない: エラーをログして次のインターバルで再試行。
 *   - scanFn を外部から注入するため、スケジューラはインフラ依存ゼロで単体テスト可能。
 *
 * 使用例（src/index.ts）:
 *   const controller = new AbortController();
 *   process.on("SIGTERM", () => controller.abort());
 *   await runScheduler(() => runSignalScan(...), {}, controller.signal);
 */

export type SchedulerOptions = {
  /**
   * スキャン間隔（ミリ秒）。
   * alignToInterval=true の場合はこの値をインターバル境界計算のベースに使用。
   * デフォルト: 4h (14_400_000ms)
   */
  intervalMs?: number;
  /**
   * 4h ローソク足クローズ後のバッファ（ミリ秒）。
   * 取引所でローソク足が確定するまでの遅延を吸収する。
   * デフォルト: 30_000ms (30s)
   */
  bufferMs?: number;
  /**
   * true の場合、intervalMs 境界（UTC 0, 4, 8, 12, 16, 20 時）に合わせてスキャン。
   * false の場合、前回スキャン完了から intervalMs 後に固定スキャン。
   * デフォルト: true
   */
  alignToInterval?: boolean;
  /**
   * true の場合、起動直後に即座にスキャンを実行してから次の境界を待つ。
   * デフォルト: true
   */
  immediate?: boolean;
};

// ── 公開ヘルパー（純粋関数・テスト容易）──────────────────────────────────────

/**
 * 次のインターバル境界までのミリ秒数を計算する（純粋関数）。
 *
 * 例: intervalMs=4h, bufferMs=30s
 *   nowMs が境界ぴったり (nowMs % intervalMs === 0) → intervalMs + bufferMs
 *   nowMs が境界から 1h 後                          → 3h + bufferMs
 *   nowMs が境界の 1ms 前                           → 1 + bufferMs
 */
export function msUntilNextBoundary(
  nowMs: number,
  intervalMs: number,
  bufferMs: number
): number {
  const msIntoInterval = nowMs % intervalMs;
  // 境界ぴったりの場合は次の（1インターバル後の）境界まで待つ
  const msUntilClose =
    msIntoInterval === 0 ? intervalMs : intervalMs - msIntoInterval;
  return msUntilClose + bufferMs;
}

// ── メインスケジューラ ──────────────────────────────────────────────────────

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

  // 起動直後スキャン
  if (immediate && !signal?.aborted) {
    await executeScan(scanFn);
  }

  // スケジュールループ（abort まで継続）
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

// ── 内部ヘルパー ────────────────────────────────────────────────────────────

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
 * ms ミリ秒スリープする。
 * AbortSignal が発火した場合は即座に解決する。
 *
 * @returns abort された場合 `true`、通常完了の場合 `false`
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

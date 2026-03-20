import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  runScheduler,
  msUntilNextBoundary,
} from "../../../src/services/scheduler/run-scheduler.js";
import type { SignalScanResult } from "../../../src/services/orchestrator/run-signal-scan.js";

/**
 * Vitest 1.x には vi.runAllMicrotasksAsync が存在しないため、
 * 複数回の Promise.resolve() でマイクロタスクキューを消化するヘルパーを定義。
 */
async function flushPromises(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

// ── テスト夾具 ────────────────────────────────────────────────────────────

const INTERVAL = 4 * 60 * 60 * 1000; // 4h
const BUFFER = 30_000; // 30s

const mockResult: SignalScanResult = {
  symbol: "BTCUSDT",
  scannedAt: Date.now(),
  candidatesFound: 0,
  candidatesAfterMacro: 0,
  alertsSent: 0,
  alertsFailed: 0,
  alertsSkipped: 0,
  macroAction: "pass",
  errors: [],
};

function makeScanFn(result = mockResult) {
  return vi.fn().mockResolvedValue(result);
}

// ── msUntilNextBoundary ───────────────────────────────────────────────────

describe("msUntilNextBoundary — 境界計算（純粋関数）", () => {
  it("境界ぴったり (nowMs % intervalMs === 0) → intervalMs + bufferMs", () => {
    expect(msUntilNextBoundary(0, INTERVAL, BUFFER)).toBe(INTERVAL + BUFFER);
  });

  it("境界から 1ms 後 → intervalMs - 1 + bufferMs", () => {
    expect(msUntilNextBoundary(1, INTERVAL, BUFFER)).toBe(INTERVAL - 1 + BUFFER);
  });

  it("インターバル半分経過 → intervalMs/2 + bufferMs", () => {
    expect(msUntilNextBoundary(INTERVAL / 2, INTERVAL, BUFFER)).toBe(
      INTERVAL / 2 + BUFFER
    );
  });

  it("境界の 1ms 前 → 1 + bufferMs", () => {
    expect(msUntilNextBoundary(INTERVAL - 1, INTERVAL, BUFFER)).toBe(
      1 + BUFFER
    );
  });

  it("1h インターバル: 45m 経過 → 15m + buffer", () => {
    const hourMs = 3_600_000;
    expect(msUntilNextBoundary(45 * 60_000, hourMs, 0)).toBe(15 * 60_000);
  });

  it("buffer=0 の場合: 境界ぴったり → intervalMs", () => {
    expect(msUntilNextBoundary(0, INTERVAL, 0)).toBe(INTERVAL);
  });

  it("異なる intervalMs でも正しく計算される", () => {
    const hourMs = 3_600_000;
    // 30m 経過 → 30m 後が次の境界
    expect(msUntilNextBoundary(30 * 60_000, hourMs, 0)).toBe(30 * 60_000);
  });
});

// ── immediate スキャン ────────────────────────────────────────────────────

describe("runScheduler — immediate スキャン", () => {
  it("immediate=true → 起動直後に scanFn が呼ばれる", async () => {
    const scanFn = makeScanFn();
    const controller = new AbortController();

    const promise = runScheduler(
      scanFn,
      { immediate: true, alignToInterval: false, intervalMs: 60_000 },
      controller.signal
    );

    // immediate スキャンは Promise 解決後（次の tick）に実行される
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(scanFn).toHaveBeenCalledTimes(1);

    controller.abort();
    await promise;
  });

  it("immediate=false → 起動直後に scanFn が呼ばれない", async () => {
    const scanFn = makeScanFn();
    const controller = new AbortController();

    const promise = runScheduler(
      scanFn,
      { immediate: false, alignToInterval: false, intervalMs: 60_000 },
      controller.signal
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(scanFn).not.toHaveBeenCalled();

    controller.abort();
    await promise;
  });

  it("起動前に abort 済み → immediate でも scanFn が呼ばれない", async () => {
    const scanFn = makeScanFn();
    const controller = new AbortController();
    controller.abort(); // 起動前に abort

    await runScheduler(
      scanFn,
      { immediate: true, alignToInterval: false, intervalMs: 60_000 },
      controller.signal
    );

    expect(scanFn).not.toHaveBeenCalled();
  });
});

// ── タイマー制御テスト（fake timers）────────────────────────────────────

describe("runScheduler — スケジュール実行（fake timers）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("alignToInterval=false → intervalMs 後に再スキャン", async () => {
    const scanFn = makeScanFn();
    const controller = new AbortController();

    const promise = runScheduler(
      scanFn,
      { immediate: false, alignToInterval: false, intervalMs: 5000 },
      controller.signal
    );

    await flushPromises();
    expect(scanFn).toHaveBeenCalledTimes(0);

    // 5000ms 進める → スキャン発火
    await vi.advanceTimersByTimeAsync(5000);
    expect(scanFn).toHaveBeenCalledTimes(1);

    controller.abort();
    await promise;
  });

  it("2 インターバル → scanFn が 2 回呼ばれる", async () => {
    const scanFn = makeScanFn();
    const controller = new AbortController();

    const promise = runScheduler(
      scanFn,
      { immediate: false, alignToInterval: false, intervalMs: 1000 },
      controller.signal
    );

    await flushPromises();

    await vi.advanceTimersByTimeAsync(1000);
    expect(scanFn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(scanFn).toHaveBeenCalledTimes(2);

    controller.abort();
    await promise;
  });

  it("immediate=true + 1 インターバル → scanFn が 2 回呼ばれる", async () => {
    const scanFn = makeScanFn();
    const controller = new AbortController();

    const promise = runScheduler(
      scanFn,
      { immediate: true, alignToInterval: false, intervalMs: 1000 },
      controller.signal
    );

    // immediate スキャン
    await flushPromises();
    expect(scanFn).toHaveBeenCalledTimes(1);

    // 1 インターバル後
    await vi.advanceTimersByTimeAsync(1000);
    expect(scanFn).toHaveBeenCalledTimes(2);

    controller.abort();
    await promise;
  });

  it("alignToInterval=true → msUntilNextBoundary で計算された遅延を使う", async () => {
    const scanFn = makeScanFn();
    const controller = new AbortController();

    const intervalMs = 4000;
    const bufferMs = 100;
    // fake timer の現在時刻: 1000ms (intervalMs の 1/4 経過)
    // → 次の境界まで: 3000 + 100 = 3100ms
    vi.setSystemTime(1000);

    const promise = runScheduler(
      scanFn,
      { immediate: false, alignToInterval: true, intervalMs, bufferMs },
      controller.signal
    );

    await flushPromises();

    // 3000ms では未発火（バッファ未満）
    await vi.advanceTimersByTimeAsync(3000);
    expect(scanFn).toHaveBeenCalledTimes(0);

    // 3100ms で発火
    await vi.advanceTimersByTimeAsync(100);
    expect(scanFn).toHaveBeenCalledTimes(1);

    controller.abort();
    await promise;
  });
});

// ── エラー回復 ───────────────────────────────────────────────────────────

describe("runScheduler — エラー回復", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("scanFn throw → ログして継続（クラッシュしない）", async () => {
    let callCount = 0;
    const scanFn = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error("Scan boom");
      return mockResult;
    });
    const controller = new AbortController();

    const promise = runScheduler(
      scanFn,
      { immediate: true, alignToInterval: false, intervalMs: 1000 },
      controller.signal
    );

    // immediate スキャン（エラー）
    await flushPromises();
    expect(scanFn).toHaveBeenCalledTimes(1);

    // 次のインターバル（成功）
    await vi.advanceTimersByTimeAsync(1000);
    expect(scanFn).toHaveBeenCalledTimes(2);

    controller.abort();
    // promise は reject しない
    await expect(promise).resolves.toBeUndefined();
  });

  it("連続エラー → 何度でも再試行する", async () => {
    const scanFn = vi.fn().mockRejectedValue(new Error("Always fails"));
    const controller = new AbortController();

    const promise = runScheduler(
      scanFn,
      { immediate: false, alignToInterval: false, intervalMs: 500 },
      controller.signal
    );

    await flushPromises();

    await vi.advanceTimersByTimeAsync(500);
    expect(scanFn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(500);
    expect(scanFn).toHaveBeenCalledTimes(2);

    controller.abort();
    await expect(promise).resolves.toBeUndefined();
  });
});

// ── グレースフルシャットダウン ───────────────────────────────────────────

describe("runScheduler — グレースフルシャットダウン", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("スリープ中に abort → 即座にループを抜ける", async () => {
    const scanFn = makeScanFn();
    const controller = new AbortController();

    const promise = runScheduler(
      scanFn,
      { immediate: false, alignToInterval: false, intervalMs: 10_000 },
      controller.signal
    );

    await flushPromises();

    // スリープ中に abort
    controller.abort();
    await flushPromises();

    await expect(promise).resolves.toBeUndefined();
    expect(scanFn).not.toHaveBeenCalled();
  });

  it("スキャン後スリープ前に abort → 次のスキャンは実行されない", async () => {
    const scanFn = makeScanFn();
    const controller = new AbortController();

    const promise = runScheduler(
      scanFn,
      { immediate: true, alignToInterval: false, intervalMs: 5000 },
      controller.signal
    );

    // immediate スキャン完了
    await flushPromises();
    expect(scanFn).toHaveBeenCalledTimes(1);

    // スリープ中に abort（5000ms 待たずに）
    controller.abort();
    await flushPromises();

    await expect(promise).resolves.toBeUndefined();
    // 2 回目は呼ばれない
    expect(scanFn).toHaveBeenCalledTimes(1);
  });

  it("abort 後に time を進めても scanFn が呼ばれない", async () => {
    const scanFn = makeScanFn();
    const controller = new AbortController();

    const promise = runScheduler(
      scanFn,
      { immediate: false, alignToInterval: false, intervalMs: 1000 },
      controller.signal
    );

    await flushPromises();
    controller.abort();
    await flushPromises();

    // abort 後に時間を大幅に進める
    await vi.advanceTimersByTimeAsync(100_000);
    expect(scanFn).not.toHaveBeenCalled();

    await promise;
  });

  it("signal なしで起動した場合も正常動作（シグナル省略）", async () => {
    const scanFn = makeScanFn();

    // signal なしだと永久ループになるので immediate=true + 起動直後に検証して終了
    // このテストは "signal なしで TypeError が起きない" ことを確認するだけ
    const promise = runScheduler(scanFn, {
      immediate: true,
      alignToInterval: false,
      intervalMs: 1_000_000, // 実質的に次は来ない
    }); // signal を渡さない

    await flushPromises();
    expect(scanFn).toHaveBeenCalledTimes(1);

    // タイムアウトを大きく進めて promise を解決させる（signal なしだと止まらないのでここで強制終了）
    // 実際のプロセスでは SIGTERM で止める
    // このテストは 1 回スキャン後の promise を「終わらない」ことを確認したいわけではないので
    // ここで setTimeout をクリアしてタイマーをキャンセルする
    vi.clearAllTimers();
    // promise は未解決のままだが、テストとしては scanFn が 1 回呼ばれたことを確認できた
    await expect(Promise.race([promise, Promise.resolve("timeout")])).resolves.toBe("timeout");
  });
});

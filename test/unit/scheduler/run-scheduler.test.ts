import { describe, it, expect, vi } from "vitest";
import { runScheduler } from "../../../src/services/scheduler/run-scheduler.js";
import type { SignalScanResult } from "../../../src/services/orchestrator/run-signal-scan.js";

const mockResult: SignalScanResult = {
  symbol: "BTCUSDT",
  scannedAt: 123456789,
  candidatesFound: 0,
  alertsSent: 0,
  alertsFailed: 0,
  alertsSkipped: 0,
  errors: [],
};

describe("run-scheduler (V2 Physics)", () => {
  it("调度器正常执行扫描循环", async () => {
    const mockScan = vi.fn().mockResolvedValue(mockResult);
    const mockMonitor = vi.fn().mockResolvedValue({ closed: 0 });
    const controller = new AbortController();

    // 运行一个极短的循环
    setTimeout(() => controller.abort(), 100);

    await runScheduler(
      {
        scanSymbols: ["BTCUSDT"],
        onScan: mockScan,
        onMonitor: mockMonitor,
        onSession: vi.fn(),
        onHeartbeat: vi.fn(),
      },
      controller.signal,
      { scanIntervalMs: 50, monitorIntervalMs: 50, sessionIntervalMs: 50, heartbeatIntervalMs: 50 }
    );

    expect(mockScan).toHaveBeenCalled();
  });
});

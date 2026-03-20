import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../../../src/utils/retry.js";

describe("withRetry", () => {
  it("returns result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, 3, 0);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValue("ok");
    const result = await withRetry(fn, 3, 0);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws after max attempts exhausted", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));
    await expect(withRetry(fn, 3, 0)).rejects.toThrow("always fails");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("calls exactly maxAttempts times on total failure", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("x"));
    try { await withRetry(fn, 5, 0); } catch {}
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it("throws immediately with descriptive error when maxAttempts <= 0", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withRetry(fn, 0, 0)).rejects.toThrow("maxAttempts must be > 0");
    expect(fn).not.toHaveBeenCalled();
  });
});

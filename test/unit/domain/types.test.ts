import { describe, it, expect } from "vitest";

describe("domain types - import smoke tests", () => {
  it("imports reason-code", async () => {
    const mod = await import("../../../src/domain/common/reason-code.js");
    expect(mod).toBeDefined();
  });
  it("imports candle", async () => {
    const mod = await import("../../../src/domain/market/candle.js");
    expect(mod).toBeDefined();
  });
  it("imports funding-rate", async () => {
    const mod = await import("../../../src/domain/market/funding-rate.js");
    expect(mod).toBeDefined();
  });
  it("imports open-interest", async () => {
    const mod = await import("../../../src/domain/market/open-interest.js");
    expect(mod).toBeDefined();
  });
  it("imports market-context", async () => {
    const mod = await import("../../../src/domain/market/market-context.js");
    expect(mod).toBeDefined();
  });
  it("imports market-regime", async () => {
    const mod = await import("../../../src/domain/regime/market-regime.js");
    expect(mod).toBeDefined();
  });
  it("imports regime-decision", async () => {
    const mod = await import("../../../src/domain/regime/regime-decision.js");
    expect(mod).toBeDefined();
  });
  it("imports participant-pressure", async () => {
    const mod = await import("../../../src/domain/participants/participant-pressure.js");
    expect(mod).toBeDefined();
  });
  it("imports news-item", async () => {
    const mod = await import("../../../src/domain/news/news-item.js");
    expect(mod).toBeDefined();
  });
  it("imports structural-setup", async () => {
    const mod = await import("../../../src/domain/signal/structural-setup.js");
    expect(mod).toBeDefined();
  });
  it("imports trade-candidate", async () => {
    const mod = await import("../../../src/domain/signal/trade-candidate.js");
    expect(mod).toBeDefined();
  });
  it("imports alert-payload", async () => {
    const mod = await import("../../../src/domain/signal/alert-payload.js");
    expect(mod).toBeDefined();
  });
  it("imports macro-assessment", async () => {
    const mod = await import("../../../src/domain/macro/macro-assessment.js");
    expect(mod).toBeDefined();
  });
});

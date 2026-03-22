import { describe, it, expect } from "vitest";
import {
  normalizePerpSymbol,
  normalizeSpotSymbol,
  resolvePriceRequest,
} from "../../../src/services/discord/discord-bot.js";

describe("normalizePerpSymbol", () => {
  const fallback = "BTC/USDT:USDT";

  it("uses fallback when input is empty", () => {
    expect(normalizePerpSymbol(null, fallback)).toBe(fallback);
    expect(normalizePerpSymbol("", fallback)).toBe(fallback);
    expect(normalizePerpSymbol("   ", fallback)).toBe(fallback);
  });

  it("converts bare asset to perp symbol", () => {
    expect(normalizePerpSymbol("btc", fallback)).toBe("BTC/USDT:USDT");
    expect(normalizePerpSymbol("eth", fallback)).toBe("ETH/USDT:USDT");
  });

  it("converts compact usdt pair to perp symbol", () => {
    expect(normalizePerpSymbol("BTCUSDT", fallback)).toBe("BTC/USDT:USDT");
    expect(normalizePerpSymbol("ETHUSDT", fallback)).toBe("ETH/USDT:USDT");
  });

  it("keeps full perp symbol unchanged", () => {
    expect(normalizePerpSymbol("BTC/USDT:USDT", fallback)).toBe("BTC/USDT:USDT");
  });

  it("appends :USDT for spot-like pair", () => {
    expect(normalizePerpSymbol("BTC/USDT", fallback)).toBe("BTC/USDT:USDT");
  });
});

describe("normalizeSpotSymbol", () => {
  const fallback = "BTC/USDT";

  it("uses fallback when input is empty", () => {
    expect(normalizeSpotSymbol(null, fallback)).toBe(fallback);
    expect(normalizeSpotSymbol("", fallback)).toBe(fallback);
  });

  it("converts bare asset and compact pair", () => {
    expect(normalizeSpotSymbol("btc", fallback)).toBe("BTC/USDT");
    expect(normalizeSpotSymbol("ETHUSDT", fallback)).toBe("ETH/USDT");
  });

  it("removes perp suffix if provided", () => {
    expect(normalizeSpotSymbol("BTC/USDT:USDT", fallback)).toBe("BTC/USDT");
  });
});

describe("resolvePriceRequest", () => {
  const defaults = {
    defaultPerpSymbol: "BTC/USDT:USDT",
    defaultSpotSymbol: "BTC/USDT",
  };

  it("defaults to perp", () => {
    expect(resolvePriceRequest({ rawSymbol: null, rawMarket: null, ...defaults })).toEqual({
      market: "perp",
      symbol: "BTC/USDT:USDT",
    });
  });

  it("resolves spot market when requested", () => {
    expect(resolvePriceRequest({ rawSymbol: "eth", rawMarket: "spot", ...defaults })).toEqual({
      market: "spot",
      symbol: "ETH/USDT",
    });
  });
});

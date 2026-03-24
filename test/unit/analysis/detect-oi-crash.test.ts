import { expect, test, describe } from "vitest";
import { detectOiCrash } from "../../../src/services/analysis/detect-oi-crash.js";
import type { OpenInterestPoint } from "../../../src/domain/market/open-interest.js";

describe("detectOiCrash (Directional Mechanics)", () => {
  // Generate mock OI data
  const generateOiPoints = (count: number, startOi: number, trend: "flat" | "up" | "down", crashAtEnd: boolean = false): OpenInterestPoint[] => {
    const points: OpenInterestPoint[] = [];
    let currentOi = startOi;
    for (let i = 0; i < count; i++) {
      if (trend === "up") currentOi *= 1.001;
      else if (trend === "down") currentOi *= 0.999;
      else currentOi *= (1 + (Math.random() - 0.5) * 0.001); // minor noise

      points.push({
        symbol: "BTCUSDT",
        timestamp: Date.now() + i * 1000,
        openInterest: currentOi,
      });
    }
    
    // Simulate crash at the end
    if (crashAtEnd) {
      points[points.length - 1].openInterest *= 0.5; // Huge 50% drop
    }
    
    return points;
  };

  test("should detect long liquidation (OI down, Price down)", () => {
    const oiPoints = generateOiPoints(20, 1000, "flat", true);
    const closePrices = [1000, 950]; // Price dropped 5%

    const result = detectOiCrash(oiPoints, closePrices, 10, 2.0);

    expect(result.isCrash).toBe(true);
    expect(result.mechanismType).toBe("long_liquidation");
    expect(result.priceChangePct).toBeLessThan(-0.001);
  });

  test("should detect short squeeze (OI down, Price up)", () => {
    const oiPoints = generateOiPoints(20, 1000, "flat", true);
    const closePrices = [1000, 1050]; // Price increased 5%

    const result = detectOiCrash(oiPoints, closePrices, 10, 2.0);

    expect(result.isCrash).toBe(true);
    expect(result.mechanismType).toBe("short_squeeze");
    expect(result.priceChangePct).toBeGreaterThan(0.001);
  });

  test("should detect mixed deleveraging (OI down, Price stable)", () => {
    const oiPoints = generateOiPoints(20, 1000, "flat", true);
    const closePrices = [1000, 1000]; // Price same

    const result = detectOiCrash(oiPoints, closePrices, 10, 2.0);

    expect(result.isCrash).toBe(true);
    expect(result.mechanismType).toBe("mixed_deleveraging");
    expect(result.priceChangePct).toBe(0);
  });
  
  test("should return unknown when price data is missing", () => {
    const oiPoints = generateOiPoints(20, 1000, "flat", true);

    const result = detectOiCrash(oiPoints, undefined, 10, 2.0);

    expect(result.isCrash).toBe(true);
    expect(result.mechanismType).toBe("unknown");
    expect(result.priceChangePct).toBe(0);
  });
});

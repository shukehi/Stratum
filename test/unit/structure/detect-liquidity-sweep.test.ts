import { expect, test, describe } from "vitest";
import { scoreSweepDepth } from "../../../src/services/structure/detect-liquidity-sweep.js";

describe("scoreSweepDepth (V3 Physics: Inverted U-Curve)", () => {
  test("Ratio < 0.3 should return base 40 (Not enough depth)", () => {
    expect(scoreSweepDepth(0.2)).toBe(40);
  });

  test("Ratio between 0.3 and 0.5 should climb linearly from 40 to 80", () => {
    expect(scoreSweepDepth(0.4)).toBe(60); // 40 + ((0.4-0.3)/0.2)*40 = 40 + 0.5*40 = 60
    expect(scoreSweepDepth(0.5)).toBe(80);
  });

  test("Ratio between 0.5 and 1.5 is the optimal zone (80 to 100)", () => {
    expect(scoreSweepDepth(1.0)).toBe(90); // 80 + ((1.0-0.5)/1.0)*20 = 80 + 10 = 90
    expect(scoreSweepDepth(1.5)).toBe(100);
  });

  test("Ratio between 1.5 and 2.5 decays linearly from 100 to 60", () => {
    expect(scoreSweepDepth(2.0)).toBe(80); // 100 - ((2.0-1.5)/1.0)*40 = 100 - 0.5*40 = 80
    expect(scoreSweepDepth(2.5)).toBe(60);
  });

  test("Ratio > 2.5 is danger zone, returning low score dependent on extremeness", () => {
    expect(scoreSweepDepth(3.0)).toBe(50); // 60 - (3.0-2.5)*20 = 60 - 10 = 50
    expect(scoreSweepDepth(4.0)).toBe(30); // 60 - 1.5*20 = 30
    expect(scoreSweepDepth(5.0)).toBe(20); // Math.max(20, 60 - 2.5*20) = 20
  });
});

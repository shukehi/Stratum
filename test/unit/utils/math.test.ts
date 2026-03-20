import { describe, it, expect } from "vitest";
import { clamp, roundTo, percentChange } from "../../../src/utils/math.js";

describe("clamp", () => {
  it("clamps below min", () => expect(clamp(-5, 0, 100)).toBe(0));
  it("clamps above max", () => expect(clamp(150, 0, 100)).toBe(100));
  it("returns value within range", () => expect(clamp(50, 0, 100)).toBe(50));
  it("returns min when equal", () => expect(clamp(0, 0, 100)).toBe(0));
  it("returns max when equal", () => expect(clamp(100, 0, 100)).toBe(100));
});

describe("roundTo", () => {
  it("rounds to 2 decimals", () => expect(roundTo(1.2345, 2)).toBe(1.23));
  it("rounds to 4 decimals", () => expect(roundTo(1.23456, 4)).toBe(1.2346));
  it("rounds to 0 decimals", () => expect(roundTo(1.6, 0)).toBe(2));
  it("rounds down", () => expect(roundTo(1.4, 0)).toBe(1));
});

describe("percentChange", () => {
  it("positive change", () => expect(percentChange(100, 110)).toBeCloseTo(0.1));
  it("negative change", () => expect(percentChange(100, 90)).toBeCloseTo(-0.1));
  it("no change", () => expect(percentChange(100, 100)).toBe(0));
  it("zero from returns 0", () => expect(percentChange(0, 100)).toBe(0));
});

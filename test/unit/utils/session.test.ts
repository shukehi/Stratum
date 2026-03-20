import { describe, it, expect } from "vitest";
import { detectLiquiditySession } from "../../../src/utils/session.js";

describe("detectLiquiditySession", () => {
  it("UTC 00 → asian_low", () => expect(detectLiquiditySession(0)).toBe("asian_low"));
  it("UTC 03 → asian_low", () => expect(detectLiquiditySession(3)).toBe("asian_low"));
  it("UTC 05 → asian_low", () => expect(detectLiquiditySession(5)).toBe("asian_low"));
  it("UTC 06 → london_ramp", () => expect(detectLiquiditySession(6)).toBe("london_ramp"));
  it("UTC 07 → london_ramp", () => expect(detectLiquiditySession(7)).toBe("london_ramp"));
  it("UTC 08 → london_ny_overlap", () => expect(detectLiquiditySession(8)).toBe("london_ny_overlap"));
  it("UTC 12 → london_ny_overlap", () => expect(detectLiquiditySession(12)).toBe("london_ny_overlap"));
  it("UTC 15 → london_ny_overlap", () => expect(detectLiquiditySession(15)).toBe("london_ny_overlap"));
  it("UTC 16 → ny_close", () => expect(detectLiquiditySession(16)).toBe("ny_close"));
  it("UTC 18 → ny_close", () => expect(detectLiquiditySession(18)).toBe("ny_close"));
  it("UTC 21 → ny_close", () => expect(detectLiquiditySession(21)).toBe("ny_close"));
  it("UTC 22 → asian_low", () => expect(detectLiquiditySession(22)).toBe("asian_low"));
  it("UTC 23 → asian_low", () => expect(detectLiquiditySession(23)).toBe("asian_low"));
});

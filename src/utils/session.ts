import type { LiquiditySession } from "../domain/market/market-context.js";

/**
 * 根据 UTC 小时判断当前流动性时段
 * asian_low:         22:00 - 06:00 UTC
 * london_ramp:       06:00 - 08:00 UTC
 * london_ny_overlap: 08:00 - 16:00 UTC
 * ny_close:          16:00 - 22:00 UTC
 */
export function detectLiquiditySession(utcHour: number): LiquiditySession {
  if (utcHour >= 6 && utcHour < 8) return "london_ramp";
  if (utcHour >= 8 && utcHour < 16) return "london_ny_overlap";
  if (utcHour >= 16 && utcHour < 22) return "ny_close";
  return "asian_low";
}

export function getCurrentSession(): LiquiditySession {
  return detectLiquiditySession(new Date().getUTCHours());
}

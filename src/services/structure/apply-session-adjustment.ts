import type { StructuralSetup } from "../../domain/signal/structural-setup.js";
import type { LiquiditySession } from "../../domain/market/market-context.js";
import type { ReasonCode } from "../../domain/common/reason-code.js";
import type { StrategyConfig } from "../../app/config.js";

/**
 * 交易时段流动性修正  (PHASE_05)
 *
 * 仅调整 structureScore，不修改 stopLossHint / takeProfitHint / 入场区间。
 *
 * 规则:
 *   asian_low     → structureScore × sessionDiscountFactor  (默认 0.8)
 *                   + 追加 SESSION_LOW_LIQUIDITY_DISCOUNT reasonCode
 *   london_ramp   → structureScore × sessionPremiumFactor   (默认 1.1)
 *   其余时段       → 不调整
 *   enableSessionAdjustment = false → 全部系数为 1.0（不调整）
 *
 * 第一性原理: 亚洲时段流动性最低，止损扫单更容易被噪音触发；
 * London/NY 开盘时段流动性充足，结构信号可信度更高。
 */
export function applySessionAdjustment(
  setup: StructuralSetup,
  session: LiquiditySession,
  config: StrategyConfig
): StructuralSetup {
  if (!config.enableSessionAdjustment) return setup;

  let factor = 1.0;
  let addDiscount = false;

  if (session === "asian_low") {
    factor = config.sessionDiscountFactor;
    addDiscount = true;
  } else if (session === "london_ramp") {
    factor = config.sessionPremiumFactor;
  }

  if (factor === 1.0) return setup;

  const newScore = Math.min(100, Math.max(0, Math.round(setup.structureScore * factor)));

  const newReasonCodes: ReasonCode[] = addDiscount
    ? [...new Set([...setup.reasonCodes, "SESSION_LOW_LIQUIDITY_DISCOUNT" as ReasonCode])]
    : [...setup.reasonCodes];

  return {
    ...setup,
    structureScore: newScore,
    reasonCodes: newReasonCodes,
  };
}

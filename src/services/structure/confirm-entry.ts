import type { Candle } from "../../domain/market/candle.js";
import type { StructuralSetup } from "../../domain/signal/structural-setup.js";
import type { ReasonCode } from "../../domain/common/reason-code.js";
import type { StrategyConfig } from "../../app/config.js";

/**
 * 入场确认机制  (PHASE_05)
 *
 * 状态机（1h K 线驱动）:
 *   pending    → 价格未进入区域，或进入后尚未触发任何确认/失效条件
 *   confirmed  → 价格进入区域后满足确认条件之一（影线比 or 不破新极值）
 *   invalidated → 1h 收盘穿透 stopLossHint → 永久失效（不再重置）
 *
 * 做多确认（满足任一即可）:
 *   1. 1h K 线下影线 / 总振幅 >= confirmationShadowRatio（默认 0.5）
 *   2. 连续 confirmationCandles 根（默认 2）1h K 线不创新低
 *
 * 做空确认（对称）:
 *   1. 1h K 线上影线 / 总振幅 >= confirmationShadowRatio
 *   2. 连续 confirmationCandles 根不创新高
 *
 * 失效: 1h 收盘 < stopLossHint（做多）或 > stopLossHint（做空）
 *
 * 重要: 已 invalidated 的 setup 直接原样返回，不再重新评估。
 */
export function confirmEntry(
  setup: StructuralSetup,
  candles1h: Candle[],
  config: StrategyConfig
): StructuralSetup {
  // 已失效：永久状态，不重置
  if (setup.confirmationStatus === "invalidated") return setup;

  // 过滤出价格已进入（触及）入场区域的 1h K 线
  const inZone = candles1h.filter(c => {
    if (setup.direction === "long") {
      // 做多: 低价触及 entryHigh 以下（价格进入区域）
      return c.low <= setup.entryHigh;
    } else {
      // 做空: 高价触及 entryLow 以上
      return c.high >= setup.entryLow;
    }
  });

  if (inZone.length === 0) {
    // 价格尚未进入区域 → pending（保持原 reasonCodes 中的 STRUCTURE_CONFIRMATION_PENDING）
    return setup;
  }

  // 从最老到最新处理（以第一个触发的状态为准）
  for (let i = 0; i < inZone.length; i++) {
    const c = inZone[i];

    // ── 失效判断（优先于确认）────────────────────────────────────────────
    if (setup.direction === "long" && c.close < setup.stopLossHint) {
      return buildResult(setup, "invalidated");
    }
    if (setup.direction === "short" && c.close > setup.stopLossHint) {
      return buildResult(setup, "invalidated");
    }

    // ── 影线确认 ──────────────────────────────────────────────────────────
    const range = c.high - c.low;
    if (range > 0) {
      if (setup.direction === "long") {
        const lowerShadow = Math.min(c.open, c.close) - c.low;
        if (lowerShadow / range >= config.confirmationShadowRatio) {
          return buildResult(setup, "confirmed");
        }
      } else {
        const upperShadow = c.high - Math.max(c.open, c.close);
        if (upperShadow / range >= config.confirmationShadowRatio) {
          return buildResult(setup, "confirmed");
        }
      }
    }

    // ── 连续不创新极值确认 ────────────────────────────────────────────────
    if (i >= config.confirmationCandles - 1) {
      const window = inZone.slice(i - config.confirmationCandles + 1, i + 1);
      if (window.length >= config.confirmationCandles) {
        if (setup.direction === "long") {
          const firstLow = window[0].low;
          const noNewLow = window.slice(1).every(cc => cc.low >= firstLow);
          if (noNewLow) {
            return buildResult(setup, "confirmed");
          }
        } else {
          const firstHigh = window[0].high;
          const noNewHigh = window.slice(1).every(cc => cc.high <= firstHigh);
          if (noNewHigh) {
            return buildResult(setup, "confirmed");
          }
        }
      }
    }
  }

  // 价格已进入区域但尚未触发确认 or 失效 → pending
  return setup;
}

/** 构建状态变更后的 StructuralSetup（更新 confirmationStatus + reasonCodes） */
function buildResult(
  setup: StructuralSetup,
  status: "confirmed" | "invalidated"
): StructuralSetup {
  // 移除 PENDING，按需追加 INVALIDATED
  const filteredCodes = setup.reasonCodes.filter(
    r => r !== "STRUCTURE_CONFIRMATION_PENDING"
  );
  const newCodes: ReasonCode[] =
    status === "invalidated"
      ? [...new Set([...filteredCodes, "STRUCTURE_CONFIRMATION_INVALIDATED" as ReasonCode])]
      : filteredCodes;

  return {
    ...setup,
    confirmationStatus: status,
    reasonCodes: newCodes,
  };
}

import type { Candle } from "../../domain/market/candle.js";
import type { StructuralSetup } from "../../domain/signal/structural-setup.js";
import type { StrategyConfig } from "../../app/config.js";
import { clamp } from "../../utils/math.js";
import { detectOiCrash } from "../analysis/detect-oi-crash.js";
import type { OpenInterestPoint } from "../../domain/market/open-interest.js";

/**
 * FVG 检测 (Fair Value Gap / 公允价值缺口)  (PHASE_05)
 *
 * 三根 K 线结构:
 *   看涨 FVG: candle[i-2].high < candle[i].low  → 缺口 = [c[i-2].high, c[i].low]
 *   看跌 FVG: candle[i-2].low  > candle[i].high → 缺口 = [c[i].high,  c[i-2].low]
 *
 * 第一性原理: FVG 代表价格快速移动时未被成交的区域（流动性真空），
 * 做市商和聪明资金倾向于回归填充该区域以完成成交，因此该区域是
 * 结构性支撑/阻力。FVG 回踩 ≠ sweep；二者触发逻辑严格分离。
 *
 * 仅扫描最近 scanWindow 根 K 线，避免返回已被填充的历史缺口。
 */
export function detectFvg(
  candles: Candle[],
  timeframe: "4h" | "1h",
  config: StrategyConfig,
  scanWindow = 30,
  oiPoints: OpenInterestPoint[] = []
): StructuralSetup[] {
  const recent = candles.slice(-scanWindow);
  if (recent.length < 3) return [];

  // OI 活跃度评估（使用 1-Sigma 阈值，比 Sweep 宽松）
  let oiActivityBonus = 0;
  if (config.fvgRequireOiActivity && oiPoints.length >= 10) {
    const closePrices = candles.map(c => c.close);
    const oiResult = detectOiCrash(oiPoints, closePrices, 50, config.fvgOiActivitySigmaThreshold);
    
    if (oiResult.isCrash) {
      // OI 发生了 1-Sigma 级别的变化 → FVG 有能量支撑
      oiActivityBonus = config.fvgOiActivityBonus;
    } else if (Math.abs(oiResult.crashIndex) < 0.5) {
      // OI 几乎没有变化（< 0.5-Sigma）→ FVG 可能是流动性真空噪音
      oiActivityBonus = config.fvgOiInactivityPenalty;
    }
  }

  const results: StructuralSetup[] = [];

  // 基准 ATR（近 50 根，用于评分归一化）
  const baseline = candles.slice(-50);
  const baselineAtr =
    baseline.reduce((sum, c) => sum + (c.high - c.low), 0) / baseline.length || 1;

  for (let i = 2; i < recent.length; i++) {
    const c0 = recent[i - 2];
    const c2 = recent[i]; // 第三根 K 线

    // ── 看涨 FVG ──────────────────────────────────────────────────────────
    // c0.high < c2.low: 第一根高点低于第三根低点，中间形成向上缺口
    if (c0.high < c2.low) {
      const entryLow = c0.high;
      const entryHigh = c2.low;
      const gapSize = entryHigh - entryLow;
      if (gapSize <= 0) continue;

      // 检查缺口形成后（i+1 起）是否已有 K 线收盘穿越整个缺口（close < entryLow）。
      // 若已填充则跳过，避免对已失效区域发出信号。
      const isFilled = recent.slice(i + 1).some(c => c.close < entryLow);
      if (isFilled) continue;

      // 止损放在缺口下方 0.5 倍缺口距离处
      const stopLossHint = entryLow - gapSize * 0.5;
      const riskDist = entryHigh - stopLossHint;
      const takeProfitHint = entryHigh + riskDist * config.minimumRiskReward;

      // 评分: 基础 55 + 缺口相对 ATR 比值奖励（上限 100） + OI 活跃度
      const gapRatio = gapSize / baselineAtr;
      const structureScore = clamp(Math.round(55 + gapRatio * 30 + oiActivityBonus), 0, 100);

      results.push({
        timeframe,
        direction: "long",
        entryLow,
        entryHigh,
        stopLossHint,
        takeProfitHint,
        structureScore,
        structureReason: `看涨FVG @[${entryLow.toFixed(0)},${entryHigh.toFixed(0)}] gap=${(gapRatio * 100).toFixed(1)}%ATR`,
        invalidationReason: `1h收盘跌破 ${stopLossHint.toFixed(0)}`,
        confluenceFactors: ["fvg"],
        confirmationStatus: "pending",
        confirmationTimeframe: "1h",
        reasonCodes: ["STRUCTURE_CONFIRMATION_PENDING"],
      });
    }

    // ── 看跌 FVG ──────────────────────────────────────────────────────────
    // c0.low > c2.high: 第一根低点高于第三根高点，中间形成向下缺口
    if (c0.low > c2.high) {
      const entryHigh = c0.low;
      const entryLow = c2.high;
      const gapSize = entryHigh - entryLow;
      if (gapSize <= 0) continue;

      // 看跌缺口：收盘穿越整个缺口（close > entryHigh）表示已填充
      const isFilled = recent.slice(i + 1).some(c => c.close > entryHigh);
      if (isFilled) continue;

      const stopLossHint = entryHigh + gapSize * 0.5;
      const riskDist = stopLossHint - entryLow;
      const takeProfitHint = entryLow - riskDist * config.minimumRiskReward;

      const gapRatio = gapSize / baselineAtr;
      const structureScore = clamp(Math.round(55 + gapRatio * 30 + oiActivityBonus), 0, 100);

      results.push({
        timeframe,
        direction: "short",
        entryLow,
        entryHigh,
        stopLossHint,
        takeProfitHint,
        structureScore,
        structureReason: `看跌FVG @[${entryLow.toFixed(0)},${entryHigh.toFixed(0)}] gap=${(gapRatio * 100).toFixed(1)}%ATR`,
        invalidationReason: `1h收盘涨破 ${stopLossHint.toFixed(0)}`,
        confluenceFactors: ["fvg"],
        confirmationStatus: "pending",
        confirmationTimeframe: "1h",
        reasonCodes: ["STRUCTURE_CONFIRMATION_PENDING"],
      });
    }
  }

  return results;
}

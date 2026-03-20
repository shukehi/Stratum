import type { Candle } from "../../domain/market/candle.js";
import type {
  DailyBias,
  DailyBiasResult,
  MarketStructure,
} from "../../domain/market/daily-bias.js";

/**
 * 日线市场结构检测器  (PHASE_16 — 修订版)
 *
 * 第一性原理：机构资金通过摆高/摆低序列留下结构性痕迹。
 * 多头结构 = 更高的摆高（HH）+ 更高的摆低（HL）→ 价格在向上寻找流动性。
 * 空头结构 = 更低的摆高（LH）+ 更低的摆低（LL）→ 价格在向下寻找流动性。
 *
 * 算法步骤：
 *   1. 枢纽检测：遍历日线 K 线，找出摆高/摆低（Pivot High/Low）。
 *      枢纽高 = 该根 K 线的最高价严格大于左右各 swingLookback 根 K 线的最高价。
 *      枢纽低 = 该根 K 线的最低价严格小于左右各 swingLookback 根 K 线的最低价。
 *   2. 取最近 2 个已确认枢纽高（SH）和 2 个已确认枢纽低（SL）。
 *   3. 对比相邻枢纽，判断结构：
 *      HH_HL → bias = bullish  |  LH_LL → bias = bearish
 *      HH_LL / LH_HL → bias = neutral（膨胀 / 收敛）
 *      insufficient → bias = neutral（枢纽点不足）
 *
 * swingLookback（默认 3）:
 *   枢纽必须是 2×lookback+1 根 K 线窗口内的最高/最低点。
 *   lookback=3 → 7 根窗口，过滤日内噪声，识别主要结构点。
 *
 * 为什么不用 EMA：
 *   EMA 是机构行为的滞后映射；摆高/摆低序列是机构行为的直接体现。
 *   在 CHoCH（结构转变）发生时，EMA 仍滞后显示旧趋势，
 *   而摆高/摆低序列能即时反映新结构，避免在关键转折点误判。
 */
export function detectDailyBias(
  candles1d: Candle[],
  swingLookback = 3,
): DailyBiasResult {
  const latestClose = candles1d.at(-1)?.close ?? 0;

  // 至少需要 lookback * 2 + 4 根才能提取 2 个枢纽
  const MIN_CANDLES = swingLookback * 2 + 4;
  if (candles1d.length < MIN_CANDLES) {
    return {
      bias: "neutral",
      structure: "insufficient",
      lastSwingHigh: null,
      lastSwingLow: null,
      latestClose,
      reason: `日线 K 线数量不足（当前 ${candles1d.length} 根，需要至少 ${MIN_CANDLES} 根），无法判断结构，默认中性`,
    };
  }

  // ── 步骤 1: 枢纽检测 ──────────────────────────────────────────────────────
  const swingHighs = findSwingHighs(candles1d, swingLookback);
  const swingLows  = findSwingLows(candles1d, swingLookback);

  // ── 步骤 2: 取最近 2 个已确认枢纽 ─────────────────────────────────────────
  if (swingHighs.length < 2 || swingLows.length < 2) {
    return {
      bias: "neutral",
      structure: "insufficient",
      lastSwingHigh: swingHighs.at(-1)?.price ?? null,
      lastSwingLow:  swingLows.at(-1)?.price ?? null,
      latestClose,
      reason: `已确认枢纽高 ${swingHighs.length} 个、枢纽低 ${swingLows.length} 个，不足以判断结构（需各 ≥ 2），默认中性`,
    };
  }

  const prevSH = swingHighs[swingHighs.length - 2].price;
  const lastSH = swingHighs[swingHighs.length - 1].price;
  const prevSL = swingLows[swingLows.length - 2].price;
  const lastSL = swingLows[swingLows.length - 1].price;

  // ── 步骤 3: 结构分类 ───────────────────────────────────────────────────────
  const higherHigh = lastSH > prevSH;
  const higherLow  = lastSL > prevSL;

  let structure: MarketStructure;
  if      ( higherHigh &&  higherLow) structure = "HH_HL";
  else if (!higherHigh && !higherLow) structure = "LH_LL";
  else if ( higherHigh && !higherLow) structure = "HH_LL";
  else                                structure = "LH_HL";

  const bias: DailyBias =
    structure === "HH_HL" ? "bullish" :
    structure === "LH_LL" ? "bearish" :
    "neutral";

  const structureLabel: Record<MarketStructure, string> = {
    HH_HL:        "更高摆高 + 更高摆低（多头结构）",
    LH_LL:        "更低摆高 + 更低摆低（空头结构）",
    HH_LL:        "更高摆高 + 更低摆低（膨胀区间，中性）",
    LH_HL:        "更低摆高 + 更高摆低（收敛区间，中性）",
    insufficient: "枢纽不足",
  };

  return {
    bias,
    structure,
    lastSwingHigh: lastSH,
    lastSwingLow:  lastSL,
    latestClose,
    reason: `日线结构：${structureLabel[structure]}。摆高 ${prevSH.toFixed(0)} → ${lastSH.toFixed(0)}，摆低 ${prevSL.toFixed(0)} → ${lastSL.toFixed(0)}`,
  };
}

// ── 枢纽检测辅助函数 ──────────────────────────────────────────────────────────

type SwingPoint = { index: number; price: number };

/**
 * 找出所有已确认的摆高（Pivot High）。
 * 条件：candles[i].high 严格大于左右各 lookback 根 K 线的最高价。
 * 右侧确认需要 lookback 根后续 K 线，因此最多检测到 length - lookback - 1 位置。
 */
function findSwingHighs(candles: Candle[], lookback: number): SwingPoint[] {
  const pivots: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const h = candles[i].high;
    let isSwing = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j !== i && candles[j].high >= h) {
        isSwing = false;
        break;
      }
    }
    if (isSwing) pivots.push({ index: i, price: h });
  }
  return pivots;
}

/**
 * 找出所有已确认的摆低（Pivot Low）。
 * 条件：candles[i].low 严格小于左右各 lookback 根 K 线的最低价。
 */
function findSwingLows(candles: Candle[], lookback: number): SwingPoint[] {
  const pivots: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const l = candles[i].low;
    let isSwing = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j !== i && candles[j].low <= l) {
        isSwing = false;
        break;
      }
    }
    if (isSwing) pivots.push({ index: i, price: l });
  }
  return pivots;
}

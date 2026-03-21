import type { Candle } from "../../domain/market/candle.js";
import type { MarketContext } from "../../domain/market/market-context.js";
import type { StructuralSetup } from "../../domain/signal/structural-setup.js";
import type { StrategyConfig } from "../../app/config.js";
import { detectFvg } from "./detect-fvg.js";
import { detectLiquiditySweep } from "./detect-liquidity-sweep.js";
import { applyConfluence } from "./detect-confluence.js";
import { confirmEntry } from "./confirm-entry.js";
import { applySessionAdjustment } from "./apply-session-adjustment.js";
import { detectEqualHighs, detectEqualLows } from "./detect-equal-levels.js";
import type { EqualLevel } from "../../domain/market/equal-level.js";

/**
 * 结构触发层主入口  (PHASE_05)
 *
 * 判断链顺序（第一性原理）:
 *   状态层（MarketContext）通过 → 参与者层通过（调用方保证）→ 结构层才执行
 *
 * 本函数职责:
 *   1. 真空期或低状态置信度 → 直接返回空数组
 *   2. 检测 FVG（4h，不与 sweep 共用逻辑）
 *   3. 检测流动性扫描（4h）
 *   4. 应用复合结构评分（confluence）
 *   5. 应用交易时段修正
 *   6. 应用 1h 入场确认
 *   7. 过滤已失效 + 分数低于阈值的 setup
 *
 * 禁止:
 *   - 不输出最终仓位
 *   - 不输出最终信号等级
 *   - 不访问宏观语义结果
 *   - 不接数据库
 */
export function detectStructuralSetups(
  candles4h: Candle[],
  candles1h: Candle[],
  ctx: MarketContext,
  config: StrategyConfig
): StructuralSetup[] {
  // ── 1. 真空期：去杠杆真空期内跳过所有结构信号 ───────────────────────────
  if (ctx.reasonCodes.includes("DELEVERAGING_VACUUM")) return [];

  // ── 2. 低状态置信度：regimeConfidence 不足时结构信号不可信 ───────────────
  if (ctx.regimeConfidence < config.minRegimeConfidence) return [];

  // ── 3. 检测 FVG（仅 4h，与 sweep 完全独立） ────────────────────────────
  const fvgSetups = detectFvg(candles4h, "4h", config);

  // ── 4. 检测流动性扫描（4h 收盘确认）──────────────────────────────────────
  const sweepSetups = detectLiquiditySweep(candles4h, config);

  // ── 5. 合并并应用复合结构加分 ─────────────────────────────────────────────
  const combined = [...fvgSetups, ...sweepSetups];
  const withConfluence = applyConfluence(combined, config);

  // ── 5b. PHASE_19: 等高等低（Equal Highs/Lows）加成 ─────────────────────
  //   等高等低代表止损极度集中的区域，机构优先扫描。
  //   当 setup 入场区与等高等低区域重叠时，追加 EQUAL_LEVEL_LIQUIDITY
  //   reason code 并提升评分（equalLevelBonus，默认 12，高于普通汇聚加成）。
  const equalHighs = detectEqualHighs(candles4h, config.equalLevelTolerance);
  const equalLows  = detectEqualLows(candles4h, config.equalLevelTolerance);
  const allEqualLevels: EqualLevel[] = [...equalHighs, ...equalLows];

  const withEqualLevel = withConfluence.map(setup =>
    applyEqualLevelBonus(setup, allEqualLevels, config.equalLevelBonus)
  );

  // ── 6. 交易时段修正 ────────────────────────────────────────────────────────
  const withSession = withEqualLevel.map(s =>
    applySessionAdjustment(s, ctx.liquiditySession, config)
  );

  // ── 7. 1h 入场确认 ─────────────────────────────────────────────────────────
  const withConfirmation = withSession.map(s =>
    confirmEntry(s, candles1h, config)
  );

  // ── 8. 过滤：已失效 setup 丢弃；分数低于阈值亦丢弃 ─────────────────────────
  return withConfirmation
    .filter(s => s.confirmationStatus !== "invalidated")
    .filter(s => s.structureScore >= config.minStructureScore);
}

// ── 等高等低加成（导出供单元测试使用）─────────────────────────────────────────

/**
 * 检查 setup 入场区是否与任一等高等低区域重叠，若是则追加加成。
 *
 * 重叠逻辑:
 *   等高区域 [price - toleranceAbs, price + toleranceAbs]
 *   setup 入场区 [entryLow, entryHigh]
 *   → 任意一侧 y ∈ [price - tol, price + tol] 即视为重叠
 *
 * 方向约束:
 *   等高（high）加成 short setup（被扫描后看跌）
 *   等低（low）加成 long setup（被扫描后看涨）
 *
 * @internal 供 detect-structural-setups 内部使用及单元测试
 */
export function applyEqualLevelBonus(
  setup: StructuralSetup,
  levels: EqualLevel[],
  bonus: number,
): StructuralSetup {
  const relevant = levels.filter(level => {
    // 方向约束
    if (level.type === "high" && setup.direction !== "short") return false;
    if (level.type === "low"  && setup.direction !== "long")  return false;

    // 区域重叠：setup 入场区 ∩ [price - tol, price + tol] ≠ ∅
    const levelLow  = level.price - level.toleranceAbsolute;
    const levelHigh = level.price + level.toleranceAbsolute;
    return setup.entryLow <= levelHigh && setup.entryHigh >= levelLow;
  });

  if (relevant.length === 0) return setup;

  // 取 touchCount 最高的等高等低区域作为代表（最密集的止损集中区）
  const best = relevant.reduce((a, b) => b.touchCount > a.touchCount ? b : a);
  const newScore = Math.min(100, setup.structureScore + bonus);

  return {
    ...setup,
    structureScore: newScore,
    structureReason:
      `${setup.structureReason} | 等${best.type === "high" ? "高" : "低"}区域×${best.touchCount}次(+${bonus}分)`,
    reasonCodes: [
      ...new Set([...setup.reasonCodes, "EQUAL_LEVEL_LIQUIDITY" as const]),
    ],
  };
}

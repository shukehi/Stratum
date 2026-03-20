import type { Candle } from "../../domain/market/candle.js";
import type { MarketContext } from "../../domain/market/market-context.js";
import type { StructuralSetup } from "../../domain/signal/structural-setup.js";
import type { StrategyConfig } from "../../app/config.js";
import { detectFvg } from "./detect-fvg.js";
import { detectLiquiditySweep } from "./detect-liquidity-sweep.js";
import { applyConfluence } from "./detect-confluence.js";
import { confirmEntry } from "./confirm-entry.js";
import { applySessionAdjustment } from "./apply-session-adjustment.js";

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

  // ── 6. 交易时段修正 ────────────────────────────────────────────────────────
  const withSession = withConfluence.map(s =>
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

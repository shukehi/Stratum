import type { StructuralSetup, ConfluenceFactor } from "../../domain/signal/structural-setup.js";
import type { ReasonCode } from "../../domain/common/reason-code.js";
import type { StrategyConfig } from "../../app/config.js";

/**
 * 两个 setup 的入场区域是否重叠（同方向）
 */
function zonesOverlap(a: StructuralSetup, b: StructuralSetup): boolean {
  return (
    a.direction === b.direction &&
    a.entryLow < b.entryHigh &&
    b.entryLow < a.entryHigh
  );
}

/**
 * 复合结构（Confluence）检测  (PHASE_05)
 *
 * 规则（互斥等级，取最高适用项）:
 *   流动性扫描 + FVG 在同一区域 → +confluenceBonus × 2  (默认 +20)  [最高优先级]
 *   3 种及以上结构类型重叠      → +confluenceBonus × 1.5 (默认 +15)
 *   2 种结构类型重叠            → +confluenceBonus       (默认 +10)
 *   加分后上限 100
 *   confluenceFactors.length >= 2 时附加 STRUCTURE_CONFLUENCE_BOOST reasonCode
 *
 * 实现策略: 遍历每个 setup，收集与之重叠的 setup 的所有 confluenceFactors，
 * 确定等级后更新 structureScore 和 reasonCodes。不合并 setup，保留各自身份。
 */
export function applyConfluence(
  setups: StructuralSetup[],
  config: StrategyConfig
): StructuralSetup[] {
  if (setups.length === 0) return [];

  return setups.map(setup => {
    // 找到所有与当前 setup 重叠的其他 setup（同方向 + 区域重叠）
    const overlapping = setups.filter(
      other => other !== setup && zonesOverlap(setup, other)
    );

    if (overlapping.length === 0) return setup;

    // 合并所有因子（含自身）
    const allFactorSet = new Set<ConfluenceFactor>([
      ...setup.confluenceFactors,
      ...overlapping.flatMap(o => o.confluenceFactors),
    ]);
    const mergedFactors: ConfluenceFactor[] = [...allFactorSet];

    const hasSweep = allFactorSet.has("liquidity-sweep");
    const hasFvg = allFactorSet.has("fvg");
    const typeCount = allFactorSet.size;

    // 确定加分等级（互斥，取最高）
    let bonus: number;
    if (hasSweep && hasFvg) {
      // 流动性扫描后同区域留下 FVG → 最高优先级
      bonus = config.confluenceBonus * 2;
    } else if (typeCount >= 3) {
      bonus = Math.round(config.confluenceBonus * 1.5);
    } else if (typeCount >= 2) {
      bonus = config.confluenceBonus;
    } else {
      return setup; // 仅 1 种类型，不加分
    }

    const newScore = Math.min(100, setup.structureScore + bonus);

    // 追加 STRUCTURE_CONFLUENCE_BOOST
    const newReasonCodes: ReasonCode[] = [
      ...new Set([
        ...setup.reasonCodes,
        "STRUCTURE_CONFLUENCE_BOOST" as ReasonCode,
      ]),
    ];

    return {
      ...setup,
      structureScore: newScore,
      confluenceFactors: mergedFactors,
      reasonCodes: newReasonCodes,
    };
  });
}

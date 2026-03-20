import type { TradeCandidate, SignalGrade } from "../../domain/signal/trade-candidate.js";
import type { MacroOverlayDecision } from "../../domain/macro/macro-assessment.js";

/**
 * 宏观覆盖层应用器  (PHASE_07)
 *
 * 职责:
 *   将 MacroOverlayDecision 作用于 TradeCandidate[]，返回处理后的候选列表。
 *
 * 规则（与 assess-macro-overlay 中的决策逻辑一一对应）:
 *   pass     → 所有候选保留原等级；仅写入 macroReason + 合并 reasonCodes
 *   downgrade→ 所有候选等级降一级（high-conviction→standard, standard→watch, watch→watch）
 *              + macroReason + MACRO_DOWNGRADED in reasonCodes
 *   block    → 返回 []（所有候选被删除）
 *
 * 不允许:
 *   - 修改结构字段（entry / stop / TP / RR）
 *   - 访问 LLM 或网络
 *   - 读取 config（所有决策已在 MacroOverlayDecision 中封装）
 */
export function applyMacroOverlay(
  candidates: TradeCandidate[],
  decision: MacroOverlayDecision
): TradeCandidate[] {
  if (decision.action === "block") {
    return [];
  }

  return candidates.map((c) => {
    const mergedCodes = [...new Set([...c.reasonCodes, ...decision.reasonCodes])];

    if (decision.action === "downgrade") {
      return {
        ...c,
        macroReason: decision.reason,
        signalGrade: downgradeGrade(c.signalGrade),
        reasonCodes: mergedCodes,
      };
    }

    // pass
    return {
      ...c,
      macroReason: decision.reason,
      reasonCodes: mergedCodes,
    };
  });
}

// ── 内部辅助 ──────────────────────────────────────────────────────────────────

function downgradeGrade(grade: SignalGrade): SignalGrade {
  if (grade === "high-conviction") return "standard";
  if (grade === "standard") return "watch";
  return "watch"; // already floor
}

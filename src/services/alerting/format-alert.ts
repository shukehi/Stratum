import type { TradeCandidate } from "../../domain/signal/trade-candidate.js";
import type { MarketContext } from "../../domain/market/market-context.js";

/**
 * アラートフォーマッタ  (PHASE_08)
 *
 * TradeCandidate + MarketContext を Telegram 送信用テキストに変換する（純粋関数）。
 *
 * 出力例:
 *   🟢 LONG BTCUSDT · HIGH-CONVICTION
 *   ─────────────────────────────────
 *   Entry  $59,800 – $60,000
 *   Stop   $58,800  (−2.0 %)
 *   TP     $63,000  (+5.0 %)
 *   RR     2.5 : 1
 *   ─────────────────────────────────
 *   Regime      trend ✓
 *   Participants ✓
 *   Structure   FVG + 流动性扫描
 *   Context     趋势市场，London 时段
 *   Macro       Fed pivot supports BTC.
 *
 * 設計方針:
 *   - Telegram MarkdownV2 ではなくプレーンテキストを使用（エスケープ不要）
 *   - 数値は読みやすい形式に整形（カンマ区切り、小数点 0-2 桁）
 *   - macroReason が undefined の場合は Macro 行を省略
 */

const GRADE_EMOJI: Record<TradeCandidate["signalGrade"], string> = {
  "high-conviction": "🔥",
  standard: "📊",
  watch: "👀",
};

const DIRECTION_EMOJI: Record<TradeCandidate["direction"], string> = {
  long: "🟢",
  short: "🔴",
};

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function pct(a: number, b: number): string {
  const p = ((b - a) / a) * 100;
  return (p >= 0 ? "+" : "") + p.toFixed(1) + " %";
}

export function formatAlert(candidate: TradeCandidate, ctx: MarketContext): string {
  const dir = candidate.direction.toUpperCase();
  const grade = candidate.signalGrade.toUpperCase().replace("-", " ");
  const dirEmoji = DIRECTION_EMOJI[candidate.direction];
  const gradeEmoji = GRADE_EMOJI[candidate.signalGrade];
  const sep = "─".repeat(33);

  const entryMid = (candidate.entryLow + candidate.entryHigh) / 2;
  const stopPct = pct(entryMid, candidate.stopLoss);
  const tpPct = pct(entryMid, candidate.takeProfit);

  const regimeCheck = candidate.regimeAligned ? "✓" : "✗";
  const partCheck = candidate.participantAligned ? "✓" : "✗";

  const lines: string[] = [
    `${dirEmoji} ${dir} ${candidate.symbol} · ${gradeEmoji} ${grade}`,
    sep,
    `Entry  $${fmt(candidate.entryLow)} – $${fmt(candidate.entryHigh)}`,
    `Stop   $${fmt(candidate.stopLoss)}  (${stopPct})`,
    `TP     $${fmt(candidate.takeProfit)}  (${tpPct})`,
    `RR     ${candidate.riskReward.toFixed(1)} : 1`,
    sep,
    `Regime       ${ctx.regime}  ${regimeCheck}`,
    `Participants ${partCheck}`,
    `Structure    ${candidate.structureReason}`,
    `Context      ${candidate.contextReason}`,
  ];

  if (candidate.macroReason) {
    lines.push(`Macro        ${candidate.macroReason}`);
  }

  return lines.join("\n");
}

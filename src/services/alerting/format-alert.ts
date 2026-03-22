import type { ReasonCode } from "../../domain/common/reason-code.js";
import type { TradeCandidate } from "../../domain/signal/trade-candidate.js";
import type { MarketContext } from "../../domain/market/market-context.js";
import type { PositionSizingSummary } from "../../domain/signal/position-sizing.js";

/**
 * 告警文本格式化器  (PHASE_08)
 *
 * 将 `TradeCandidate + MarketContext` 转为 Telegram 可直接发送的纯文本。
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
 * 设计方针：
 *   - 使用纯文本而非 Telegram MarkdownV2，避免额外转义；
 *   - 数值统一格式化，提升阅读速度；
 *   - `macroReason` 缺失时直接省略对应行。
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

const GRADE_LABEL: Record<TradeCandidate["signalGrade"], string> = {
  "high-conviction": "高信念",
  standard: "标准",
  watch: "观察",
};

const DIRECTION_LABEL: Record<TradeCandidate["direction"], string> = {
  long: "多头",
  short: "空头",
};

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function pct(a: number, b: number): string {
  const p = ((b - a) / a) * 100;
  return (p >= 0 ? "+" : "") + p.toFixed(1) + " %";
}

function fmtRiskPct(n: number): string {
  return `${(n * 100).toFixed(1)} %`;
}

function inferBaseAsset(symbol: string): string {
  return symbol
    .replace(/USDT$/u, "")
    .replace(/USDC$/u, "")
    .replace(/USD$/u, "")
    .replace(/PERP$/u, "");
}

export function formatAlert(
  candidate: TradeCandidate,
  ctx: MarketContext,
  positionSizing?: PositionSizingSummary
): string {
  const dir = DIRECTION_LABEL[candidate.direction];
  const grade = GRADE_LABEL[candidate.signalGrade];
  const dirEmoji = DIRECTION_EMOJI[candidate.direction];
  const gradeEmoji = GRADE_EMOJI[candidate.signalGrade];
  const sep = "─".repeat(33);

  const entryMid = (candidate.entryLow + candidate.entryHigh) / 2;
  const stopPct = pct(entryMid, candidate.stopLoss);
  const tpPct = pct(entryMid, candidate.takeProfit);

  const regimeCheck = candidate.regimeAligned ? "✓" : "✗";
  const partCheck = candidate.participantAligned ? "✓" : "✗";
  const confirmationStatus = inferConfirmationStatus(candidate.reasonCodes);
  const dailyBias = inferDailyBias(candidate.reasonCodes);
  const orderFlowBias = inferOrderFlowBias(candidate.reasonCodes);

  const lines: string[] = [
    `${dirEmoji} ${dir} ${candidate.symbol} · ${gradeEmoji} ${grade}`,
    sep,
    `入场区    $${fmt(candidate.entryLow)} – $${fmt(candidate.entryHigh)}`,
    `止损      $${fmt(candidate.stopLoss)}  (${stopPct})`,
    `止盈      $${fmt(candidate.takeProfit)}  (${tpPct})`,
    `盈亏比    ${candidate.riskReward.toFixed(1)} : 1`,
    sep,
    `市场状态  ${formatRegime(ctx.regime)}  ${regimeCheck}`,
    `参与者    ${partCheck}`,
    `压力类型  ${formatPressureType(ctx.participantPressureType)}`,
    `确认状态  ${formatConfirmationStatus(confirmationStatus)}`,
    `交易时段  ${formatSession(ctx.liquiditySession)}`,
    `日线偏向  ${formatBias(dailyBias)}`,
    `订单流    ${formatBias(orderFlowBias)}`,
    `结构原因  ${candidate.structureReason}`,
    `上下文    ${formatContextSummary(candidate.contextReason)}`,
  ];

  if (candidate.macroReason) {
    lines.push(`宏观        ${candidate.macroReason}`);
  }

  if (positionSizing) {
    lines.push(sep);
    const riskLine = positionSizing.riskAmount !== undefined
      ? `单笔风险    $${fmt(positionSizing.riskAmount)}  (${fmtRiskPct(positionSizing.accountRiskPercent)})`
      : `单笔风险    目标 ${fmtRiskPct(positionSizing.accountRiskPercent)}`;
    lines.push(riskLine);

    if (positionSizing.status === "available") {
      lines.push(
        `建议仓位    $${fmt(positionSizing.recommendedPositionSize ?? 0)} 名义仓位 · ${(
          positionSizing.recommendedBaseSize ?? 0
        ).toFixed(3)} ${inferBaseAsset(candidate.symbol)}`
      );
    } else {
      const reason =
        positionSizing.reason === "account_size_missing"
          ? "缺少账户规模"
          : "止损距离无效";
      lines.push(`建议仓位    无法计算（${reason}）`);
    }

    lines.push(
      `同向暴露    ${dir} ${positionSizing.sameDirectionExposureCount} 笔 · ${fmtRiskPct(
        positionSizing.sameDirectionExposureRiskPercent
      )} -> ${fmtRiskPct(positionSizing.projectedSameDirectionRiskPercent)}`
    );
    lines.push(
      `组合风险    ${fmtRiskPct(positionSizing.portfolioOpenRiskPercent)} -> ${fmtRiskPct(
        positionSizing.projectedPortfolioRiskPercent
      )}`
    );
  }

  return lines.join("\n");
}

function inferConfirmationStatus(reasonCodes: ReasonCode[]): "pending" | "confirmed" | "invalidated" {
  if (reasonCodes.includes("STRUCTURE_CONFIRMATION_INVALIDATED")) return "invalidated";
  if (reasonCodes.includes("STRUCTURE_CONFIRMATION_PENDING")) return "pending";
  return "confirmed";
}

function inferDailyBias(reasonCodes: ReasonCode[]): "bullish" | "bearish" | "neutral" {
  if (reasonCodes.includes("DAILY_TREND_ALIGNED")) return "bullish";
  if (reasonCodes.includes("DAILY_TREND_COUNTER")) return "bearish";
  return "neutral";
}

function inferOrderFlowBias(reasonCodes: ReasonCode[]): "bullish" | "bearish" | "neutral" {
  if (reasonCodes.includes("ORDER_FLOW_ALIGNED")) return "bullish";
  if (reasonCodes.includes("ORDER_FLOW_COUNTER")) return "bearish";
  return "neutral";
}

function formatRegime(regime: MarketContext["regime"]): string {
  if (regime === "trend") return "趋势";
  if (regime === "range") return "震荡";
  if (regime === "high-volatility") return "高波动";
  return "事件驱动";
}

function formatPressureType(pressureType: MarketContext["participantPressureType"]): string {
  if (pressureType === "squeeze-risk") return "逼空风险";
  if (pressureType === "flush-risk") return "踩踏风险";
  return "无";
}

function formatConfirmationStatus(status: "pending" | "confirmed" | "invalidated"): string {
  if (status === "pending") return "待确认";
  if (status === "invalidated") return "已失效";
  return "已确认";
}

function formatSession(session: MarketContext["liquiditySession"]): string {
  if (session === "asian_low") return "亚洲低流动性";
  if (session === "london_ramp") return "伦敦启动";
  if (session === "london_ny_overlap") return "伦敦纽约重叠";
  return "纽约尾盘";
}

function formatBias(bias: "bullish" | "bearish" | "neutral"): string {
  if (bias === "bullish") return "看多";
  if (bias === "bearish") return "看空";
  return "中性";
}

function formatContextSummary(contextReason: string): string {
  return contextReason
    .replace(/^Regime:\s*/u, "状态：")
    .replace(/\s*\|\s*Driver:\s*/u, "；驱动：")
    .replace(/\s*\|\s*Participants:\s*/u, "；参与者：")
    .replace(/\s*\|\s*Session:\s*/u, "；时段：")
    .replace(/\brange\b/gu, "震荡")
    .replace(/\btrend\b/gu, "趋势")
    .replace(/\bhigh-volatility\b/gu, "高波动")
    .replace(/\bevent-driven\b/gu, "事件驱动")
    .replace(/\bshort-covering\b/gu, "空头回补")
    .replace(/\blong-liquidation\b/gu, "多头清算")
    .replace(/\bnew-longs\b/gu, "新增多头")
    .replace(/\bnew-shorts\b/gu, "新增空头")
    .replace(/\bunclear\b/gu, "不明确")
    .replace(/\blong-crowded\b/gu, "多头拥挤")
    .replace(/\bshort-crowded\b/gu, "空头拥挤")
    .replace(/\bbalanced\b/gu, "均衡")
    .replace(/\bsqueeze-risk\b/gu, "逼空风险")
    .replace(/\bflush-risk\b/gu, "踩踏风险")
    .replace(/\bnone\b/gu, "无")
    .replace(/\basian_low\b/gu, "亚洲低流动性")
    .replace(/\blondon_ramp\b/gu, "伦敦启动")
    .replace(/\blondon_ny_overlap\b/gu, "伦敦纽约重叠")
    .replace(/\bny_close\b/gu, "纽约尾盘");
}

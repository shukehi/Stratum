import type { AlertPayload } from "../../domain/signal/alert-payload.js";
import type { TradeCandidate } from "../../domain/signal/trade-candidate.js";
import type { MarketContext } from "../../domain/market/market-context.js";
import type { PositionSizingSummary } from "../../domain/signal/position-sizing.js";

/**
 * 通知格式化模块 (PHASE_08)
 *
 * 职责：
 *   将 AlertPayload 转换为清晰易读的 Telegram / Discord 消息文本。
 *
 * 格式示例：
 *   🚨 [A+] BTC/USDT:USDT 做多
 *   入场区间：60000 - 60500
 *   止损：59000 (2.5%)
 *   止盈：64000 (5.8%)
 *   盈亏比：2.3
 *
 *   环境        趋势市 (Trend)
 *   参与者      卖方枯竭 (Short Squeeze)
 *   结构        看涨FVG回踩
 *   建议仓位    $1000 (10% 风险)
 */

const GRADE_EMOJI: Record<TradeCandidate["signalGrade"], string> = {
  "high-conviction": "🚨",
  "standard": "🟢",
  "watch": "👀",
};

const GRADE_LABEL: Record<TradeCandidate["signalGrade"], string> = {
  "high-conviction": "A+",
  "standard": "A",
  "watch": "B",
};

export type FormatAlertOptions = {
  positionSizing?: PositionSizingSummary;
};

export function formatAlert(
  payload: AlertPayload,
  options: FormatAlertOptions = {}
): string {
  const { candidate, marketContext: ctx } = payload;
  const { positionSizing } = options;

  const emoji = GRADE_EMOJI[candidate.signalGrade];
  const grade = GRADE_LABEL[candidate.signalGrade];
  const directionStr = candidate.direction === "long" ? "做多" : "做空";

  const entryMid = (candidate.entryLow + candidate.entryHigh) / 2;
  const slPct = Math.abs(entryMid - candidate.stopLoss) / entryMid * 100;
  const tpPct = Math.abs(entryMid - candidate.takeProfit) / entryMid * 100;

  const header = `${emoji} [${grade}] ${candidate.symbol} ${directionStr}`;
  const priceBlock = [
    `入场区间：${candidate.entryLow.toLocaleString()} - ${candidate.entryHigh.toLocaleString()}`,
    `止损：${candidate.stopLoss.toLocaleString()} (${slPct.toFixed(2)}%)`,
    `止盈：${candidate.takeProfit.toLocaleString()} (${tpPct.toFixed(2)}%)`,
    `盈亏比：${candidate.riskReward.toFixed(2)}`,
  ].join("\n");

  const envDesc = formatContext(ctx);

  const lines = [
    header,
    "",
    priceBlock,
    "",
    `环境        ${envDesc}`,
    `结构        ${candidate.structureReason}`,
    `状态        ${candidate.contextReason}`,
  ];

  if (positionSizing?.recommendedPositionSize && positionSizing.recommendedPositionSize > 0) {
    const sizeUsd = positionSizing.recommendedPositionSize.toFixed(2);
    const riskUsd = (positionSizing.riskAmount ?? 0).toFixed(2);
    lines.push(`建议仓位    $${sizeUsd} (风险: $${riskUsd})`);
  }

  return lines.join("\n");
}

function formatContext(ctx: MarketContext): string {
  const regimeDesc = ctx.regime === "trend" ? "趋势市" : "震荡市";
  const pBiasDesc =
    ctx.participantBias === "bullish" ? "偏多" :
    ctx.participantBias === "bearish" ? "偏空" : "中性";

  return `${regimeDesc} | 情绪${pBiasDesc}`;
}

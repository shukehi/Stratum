import type { AlertPayload } from "../../domain/signal/alert-payload.js";
import type { MarketContext } from "../../domain/market/market-context.js";
import type { PositionSizingSummary } from "../../domain/signal/position-sizing.js";

/**
 * 通知格式化模块 (PHASE_08 - V2 Physics)
 *
 * 职责：
 *   将 AlertPayload 转换为清晰易读的物理动能报告。
 *
 * 格式示例：
 *   🚀 [CVS: 85.5] BTC/USDT 做多
 *   入场区间：60000 - 60500
 *   止损：59000 (2.5%)
 *   止盈：64000 (5.8%)
 *   盈亏比：2.3
 *
 *   环境        趋势市 | 情绪偏多
 *   结构        看涨流动性扫荡(物理确认)
 *   状态        Test Context
 */

export type FormatAlertOptions = {
  positionSizing?: PositionSizingSummary;
};

export function formatAlert(
  payload: AlertPayload,
  options: FormatAlertOptions = {}
): string {
  const { candidate, marketContext: ctx } = payload;
  const { positionSizing } = options;

  const cvs = candidate.capitalVelocityScore.toFixed(1);
  const directionStr = candidate.direction === "long" ? "做多" : "做空";
  const emoji = candidate.direction === "long" ? "🚀" : "📉";

  const entryMid = (candidate.entryLow + candidate.entryHigh) / 2;
  const slPct = Math.abs(entryMid - candidate.stopLoss) / entryMid * 100;
  const tpPct = Math.abs(entryMid - candidate.takeProfit) / entryMid * 100;

  const header = `${emoji} [CVS: ${cvs}] ${candidate.symbol} ${directionStr}`;
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
    ctx.participantBias === "long-crowded" ? "多头拥挤" :
    ctx.participantBias === "short-crowded" ? "空头拥挤" : "平衡";

  return `${regimeDesc} | 情绪${pBiasDesc}`;
}

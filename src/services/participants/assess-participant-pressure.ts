import type { Candle } from "../../domain/market/candle.js";
import type { FundingRatePoint } from "../../domain/market/funding-rate.js";
import type { OpenInterestPoint } from "../../domain/market/open-interest.js";
import type { ParticipantPressure } from "../../domain/participants/participant-pressure.js";
import type { ReasonCode } from "../../domain/common/reason-code.js";
import type { StrategyConfig } from "../../app/config.js";
import { clamp, percentChange } from "../../utils/math.js";

/**
 * 参与者压力评估 (PHASE_04)
 *
 * 价格 × OI 四象限矩阵（第一性原理）:
 *   价格↑ + OI↑ → 新多头入场         → long-crowded  + flush-risk
 *   价格↓ + OI↑ → 新空头入场         → short-crowded + squeeze-risk
 *   价格↑ + OI↓ → 空头平仓 / 逼空    → short-crowded + squeeze-risk (进行中)
 *   价格↓ + OI↓ → 多头平仓 / 去杠杆  → long-crowded  + flush-risk  (进行中)
 *   OI 急跌 ≥ oiCollapseVacuumThresholdPercent + 价格↓ → DELEVERAGING_VACUUM
 *
 * 现货-永续基差背离:
 *   spotPerpBasis = (spotPrice - perpPrice) / spotPrice
 *   当 |basis| ≥ basisDivergenceThreshold 且基差方向与资金费率方向相反 →
 *   basisDivergence = true，对应方向置信度 + basisDivergenceConfidenceBoost
 */
export function assessParticipantPressure(
  candles: Candle[],
  fundingRates: FundingRatePoint[],
  openInterest: OpenInterestPoint[],
  spotPrice: number,
  config: StrategyConfig
): ParticipantPressure {
  const reasons: string[] = [];
  const reasonCodes: ReasonCode[] = [];

  // ── 价格变化（最近 4 根 4h K 线 = 16h）──────────────────────────────────
  const priceWindow = candles.slice(-4);
  const priceChange =
    priceWindow.length >= 2
      ? percentChange(priceWindow[0].open, priceWindow[priceWindow.length - 1].close)
      : 0;

  // ── OI 变化（最近 4 小时数据点）────────────────────────────────────────
  const oiWindow = openInterest.slice(-4);
  const oiChange =
    oiWindow.length >= 2
      ? percentChange(oiWindow[0].openInterest, oiWindow[oiWindow.length - 1].openInterest)
      : 0;

  // ── 资金费率均值（最近 3 个结算周期）────────────────────────────────────
  const fundingWindow = fundingRates.slice(-3);
  const avgFunding =
    fundingWindow.length > 0
      ? fundingWindow.reduce((sum, f) => sum + f.fundingRate, 0) / fundingWindow.length
      : 0;

  // ── 去杠杆真空检测 ───────────────────────────────────────────────────────
  // 条件：OI 跌幅 ≥ oiCollapseVacuumThresholdPercent（默认 10%）且价格同步下跌
  const isDelevVacuum =
    oiChange <= -config.oiCollapseVacuumThresholdPercent && priceChange < 0;

  // ── 四象限分类 ───────────────────────────────────────────────────────────
  let bias: "long-crowded" | "short-crowded" | "balanced";
  let pressureType: "squeeze-risk" | "flush-risk" | "none";
  let confidence: number;

  if (isDelevVacuum) {
    bias = "balanced";
    pressureType = "none";
    confidence = 40;
    reasons.push(
      `去杠杆真空: OI 跌幅 ${(oiChange * 100).toFixed(2)}% ≥ 阈值 ${(config.oiCollapseVacuumThresholdPercent * 100).toFixed(0)}% + 价格下跌`
    );
    reasonCodes.push("DELEVERAGING_VACUUM");
  } else if (priceChange > 0 && oiChange > 0) {
    // 价格↑ + OI↑: 新多头入场，多头拥挤，若反转则多头被冲刷
    bias = "long-crowded";
    pressureType = "flush-risk";
    confidence = clamp(60 + oiChange * 300, 50, 85);
    reasons.push(
      `价格上涨 ${(priceChange * 100).toFixed(2)}% + OI 增加 ${(oiChange * 100).toFixed(2)}%: 新多头入场，多头拥挤`
    );
    reasonCodes.push("PARTICIPANT_LONG_CROWDED");
  } else if (priceChange < 0 && oiChange > 0) {
    // 价格↓ + OI↑: 新空头入场，空头拥挤，存在逼空风险
    bias = "short-crowded";
    pressureType = "squeeze-risk";
    confidence = clamp(60 + oiChange * 300, 50, 85);
    reasons.push(
      `价格下跌 ${(priceChange * 100).toFixed(2)}% + OI 增加 ${(oiChange * 100).toFixed(2)}%: 新空头入场，空头拥挤`
    );
    reasonCodes.push("PARTICIPANT_SHORT_CROWDED");
  } else if (priceChange > 0 && oiChange < 0) {
    // 价格↑ + OI↓: 空头平仓 / 逼空进行中
    bias = "short-crowded";
    pressureType = "squeeze-risk";
    confidence = 55;
    reasons.push(
      `价格上涨 ${(priceChange * 100).toFixed(2)}% + OI 减少 ${(oiChange * 100).toFixed(2)}%: 空头被迫平仓，逼空进行中`
    );
    reasonCodes.push("PARTICIPANT_SHORT_CROWDED");
  } else if (priceChange < 0 && oiChange < 0) {
    // 价格↓ + OI↓: 多头平仓进行中（非真空级别）
    bias = "long-crowded";
    pressureType = "flush-risk";
    confidence = 55;
    reasons.push(
      `价格下跌 ${(priceChange * 100).toFixed(2)}% + OI 减少 ${(oiChange * 100).toFixed(2)}%: 多头被迫平仓进行中`
    );
    reasonCodes.push("PARTICIPANT_LONG_CROWDED");
  } else {
    // 无明显联动
    bias = "balanced";
    pressureType = "none";
    confidence = 50;
    reasons.push("价格与 OI 无明显联动，参与者均衡");
  }

  // ── 资金费率方向辅助确认 ──────────────────────────────────────────────────
  const FUNDING_THRESHOLD = 0.0001;
  if (Math.abs(avgFunding) >= FUNDING_THRESHOLD) {
    if (avgFunding > 0 && bias === "long-crowded") {
      confidence = clamp(confidence + 8, 0, 100);
      reasons.push(`资金费率为正 (${avgFunding.toFixed(6)}): 多头支付，确认多头拥挤`);
    } else if (avgFunding < 0 && bias === "short-crowded") {
      confidence = clamp(confidence + 8, 0, 100);
      reasons.push(`资金费率为负 (${avgFunding.toFixed(6)}): 空头支付，确认空头拥挤`);
    } else {
      reasons.push(`资金费率 ${avgFunding.toFixed(6)} 与仓位偏向不完全一致`);
    }
  }

  // ── 现货-永续基差背离检测 ─────────────────────────────────────────────────
  // spotPerpBasis = (spotPrice - perpPrice) / spotPrice
  // spot > perp (basis > 0): perp 折价，现货溢价
  // spot < perp (basis < 0): perp 溢价（更常见，表示多头愿意付溢价）
  const perpPrice = candles[candles.length - 1].close;
  const spotPerpBasis = spotPrice > 0 ? (spotPrice - perpPrice) / spotPrice : 0;

  let basisDivergence = false;

  if (spotPrice > 0 && Math.abs(spotPerpBasis) >= config.basisDivergenceThreshold) {
    // 基差方向与资金费率方向异号 → 背离（第一性原理）:
    //   basis > 0 (spot > perp, 现货溢价) + funding < 0 (空头付钱, 期货看跌) → 现货看涨但期货悲观 → squeeze risk
    //   basis < 0 (spot < perp, 期货溢价) + funding > 0 (多头付钱, 期货看涨) → 期货拥挤多头 → flush risk
    // 判断方法: spotPerpBasis * avgFunding < 0 (符号相反即背离)
    if (spotPerpBasis * avgFunding < 0) {
      // 基差方向与资金费率方向相反 → 背离
      basisDivergence = true;
      confidence = clamp(confidence + config.basisDivergenceConfidenceBoost, 0, 100);
      reasons.push(
        `现货-永续基差背离: basis=${spotPerpBasis.toFixed(4)}` +
        ` (${spotPerpBasis < 0 ? "perp溢价" : "现货溢价"})` +
        `, funding=${avgFunding.toFixed(6)}` +
        ` (${avgFunding >= 0 ? "多头付" : "空头付"}) → 方向矛盾，置信度 +${config.basisDivergenceConfidenceBoost}`
      );
      reasonCodes.push("PARTICIPANT_BASIS_DIVERGENCE");
    }
  } else if (spotPrice === 0) {
    reasons.push("现货价格不可用 (spotPrice=0)，跳过基差背离检测");
  }

  return {
    bias,
    pressureType,
    confidence: Math.round(clamp(confidence, 0, 100)),
    rationale: reasons.join("; "),
    spotPerpBasis,
    basisDivergence,
    reasonCodes,
  };
}

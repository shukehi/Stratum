import type { OpenInterestPoint } from "../../domain/market/open-interest.js";
import { logger } from "../../app/logger.js";

/**
 * 3-Sigma OI 坍缩检测器  (V3 - Physics First)
 *
 * 职责：
 *   使用统计力学（标准差）来识别真正的持仓坍缩，而非死板的百分比阈值。
 *
 * 物理公式：
 *   1. OI_Change_Rate = (current - prev) / prev
 *   2. Mean = 滚动平均 (OI_Change_Rate, window=50)
 *   3. StdDev = 滚动标准差 (OI_Change_Rate, window=50)
 *   4. Index = (Current_Rate - Mean) / StdDev
 *
 * 判定准则：
 *   Index < -3.0  => 强力坍缩 (3-Sigma Crash)
 */

export type OiLiquidationMechanism =
  | "long_liquidation"   // OI↓ + Price↓ → 多头被清算 → 支持看涨 Sweep
  | "short_squeeze"      // OI↓ + Price↑ → 空头被清算 → 支持看跌 Sweep  
  | "mixed_deleveraging" // OI↓ + Price 震荡 → 双向排毒，方向不明
  | "unknown";           // 样本不足

export type OiCrashResult = {
  isCrash: boolean;
  crashIndex: number; // 偏离标准差的倍数 (负数表示减少)
  currentRate: number;
  threshold: number;
  reason: string;
  mechanismType: OiLiquidationMechanism;
  priceChangePct: number;
};

export function detectOiCrash(
  oiPoints: OpenInterestPoint[],
  closePrices?: number[],
  lookback = 50,
  sigmaThreshold = 3.0
): OiCrashResult {
  if (oiPoints.length < 10) {
    return {
      isCrash: false,
      crashIndex: 0,
      currentRate: 0,
      threshold: sigmaThreshold,
      reason: "OI 样本不足，跳过动能验证",
      mechanismType: "unknown",
      priceChangePct: 0,
    };
  }

  // 1. 计算变动率序列
  const rates: number[] = [];
  for (let i = 1; i < oiPoints.length; i++) {
    const prev = oiPoints[i - 1].openInterest;
    const curr = oiPoints[i].openInterest;
    if (prev > 0) {
      rates.push((curr - prev) / prev);
    }
  }

  if (rates.length < 5) {
    return {
      isCrash: false,
      crashIndex: 0,
      currentRate: 0,
      threshold: sigmaThreshold,
      reason: "变动率样本不足",
      mechanismType: "unknown",
      priceChangePct: 0,
    };
  }

  const currentRate = rates[rates.length - 1];
  const history = rates.slice(-lookback - 1, -1); // 不含当前值

  // 2. 计算历史统计量
  const n = history.length;
  const mean = history.reduce((a, b) => a + b, 0) / n;
  const variance = history.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
  const stdDev = Math.sqrt(variance) || 0.0001; // 防止除零

  // 3. 计算 3-Sigma 索引
  const crashIndex = (currentRate - mean) / stdDev;
  const isCrash = crashIndex < -sigmaThreshold;

  let mechanismType: OiLiquidationMechanism = "unknown";
  let priceChangePct = 0;

  if (closePrices && closePrices.length >= 2) {
    const recentPrices = closePrices.slice(-2); // 只取最近2根
    priceChangePct = (recentPrices[1] - recentPrices[0]) / recentPrices[0];
    const PRICE_DIRECTION_THRESHOLD = 0.001; // 0.1% 以内视为横盘

    if (priceChangePct < -PRICE_DIRECTION_THRESHOLD) {
      mechanismType = "long_liquidation";   // OI↓ + Price↓ → 多头被清算
    } else if (priceChangePct > PRICE_DIRECTION_THRESHOLD) {
      mechanismType = "short_squeeze";       // OI↓ + Price↑ → 空头被逼空
    } else {
      mechanismType = "mixed_deleveraging"; // OI↓ + Price≈0 → 双向排毒
    }
  }

  const result: OiCrashResult = {
    isCrash,
    crashIndex,
    currentRate,
    threshold: sigmaThreshold,
    reason: isCrash
      ? `检测到物理坍缩: OI变动率 ${ (currentRate * 100).toFixed(2) }% 偏离均值 ${ crashIndex.toFixed(1) } 倍标准差`
      : `动能正常: OI变动率在 ${ sigmaThreshold }-Sigma 噪音范围内 (${ crashIndex.toFixed(1) } Sigma)`,
    mechanismType,
    priceChangePct,
  };

  if (isCrash) {
    logger.info({ result }, "Physics Engine: OI Crash Detected");
  }

  return result;
}

/**
 * OI 快速预警检测（2-Sigma 级别，比主门控更敏感）
 * 用于 5min 快速轮询，不作为主流水线门控
 */
export function detectOiAlert(
  oiPoints: OpenInterestPoint[],
  lookback = 50,
  alertSigmaThreshold = 2.0 // 比主门控（3.0）更敏感
): { shouldAlert: boolean; alertIndex: number } {
  // 复用现有统计逻辑，只是阈值从 3.0 降至 2.0
  const crashResult = detectOiCrash(oiPoints, undefined, lookback, alertSigmaThreshold);
  return {
    shouldAlert: crashResult.isCrash,
    alertIndex: crashResult.crashIndex,
  };
}

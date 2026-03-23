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

export type OiCrashResult = {
  isCrash: boolean;
  crashIndex: number; // 偏离标准差的倍数 (负数表示减少)
  currentRate: number;
  threshold: number;
  reason: string;
};

export function detectOiCrash(
  oiPoints: OpenInterestPoint[],
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

  const result: OiCrashResult = {
    isCrash,
    crashIndex,
    currentRate,
    threshold: sigmaThreshold,
    reason: isCrash
      ? `检测到物理坍缩: OI变动率 ${ (currentRate * 100).toFixed(2) }% 偏离均值 ${ crashIndex.toFixed(1) } 倍标准差`
      : `动能正常: OI变动率在 ${ sigmaThreshold }-Sigma 噪音范围内 (${ crashIndex.toFixed(1) } Sigma)`,
  };

  if (isCrash) {
    logger.info({ result }, "Physics Engine: OI Crash Detected");
  }

  return result;
}

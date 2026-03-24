import { env } from "./env.js";

/**
 * `StrategyConfig` 是系统策略参数的统一类型定义。
 *
 * 设计要点：
 *   - `boolean` / `number` 字段保持可拓宽类型，便于测试时局部覆写；
 *   - 字符串联合类型字段保留具体字面量，防止传入非法周期；
 *   - `strategyConfig` 通过 `as const satisfies StrategyConfig` 声明，
 *     同时获得字面量推导与类型兼容性校验。
 */
export type StrategyConfig = {
  // --- 周期与数据 ---
  readonly primaryTimeframe: "4h";
  readonly secondaryTimeframe: "1h";
  readonly marketDataLimit: number;

  // --- 风险回报 ---
  readonly minimumRiskReward: number;
  readonly riskPerTrade: number;
  readonly accountSizeUsd: number;

  // --- 市场状态 ---
  readonly minRegimeConfidence: number;
  readonly eventDrivenOverrideScore: number;
  readonly highVolatilityOverrideScore: number;
  readonly minRegimeScoreGap: number;
  readonly trendExtensionAtrPenaltyThreshold: number;

  // --- 参与者压力 ---
  readonly minParticipantConfidence: number;
  readonly oiCollapseVacuumThresholdPercent: number;
  readonly basisDivergenceThreshold: number;
  readonly basisDivergenceConfidenceBoost: number;

  // --- 结构触发 ---
  readonly liquiditySweepConfirmationTimeframe: "4h";
  readonly minStructureScore: number;
  readonly minStructureScoreForWeakParticipantOverride: number;
  readonly confluenceBonus: number;
  readonly confirmationShadowRatio: number;
  readonly confirmationCandles: number;
  readonly requireCvdAlignmentForSweep: boolean; // 是否要求 CVD 方向对齐（默认 false，降权但不屏蔽）

  // --- 交易时段 ---
  readonly enableSessionAdjustment: boolean;
  readonly sessionDiscountFactor: number;
  readonly sessionPremiumFactor: number;

  // --- 风控门槛 ---
  readonly maxStopDistanceAtr: number;
  readonly maxCorrelatedSignalsPerDirection: number;
  readonly maxSameDirectionOpenRiskPercent: number;
  readonly maxPortfolioOpenRiskPercent: number;

  // --- 事件与语义 ---
  readonly recentEventWatchWindowHours: number;
  readonly minimumMacroConfidence: number;
  readonly minimumBtcRelevance: number;
  readonly allowEventDrivenSignals: boolean;
  readonly maxNewsItemsForPrompt: number;

  // --- 日线趋势过滤（Volume Profile）---
  readonly dailyDataLimit: number;       // 拉取的日线 K 线数量（持久化缓存用）
  readonly vpLookbackDays: number;       // VP 计算窗口（近 N 根日线，默认 30）
  readonly vpBucketCount: number;        // VP 价格分桶数（默认 200）
  readonly vpValueAreaPercent: number;   // 价值区间覆盖比例（默认 0.70 = 70%）
  readonly cvdWindow: number;            // CVD 分析窗口（最近 N 根 4h K 线）
  readonly cvdNeutralThreshold: number;  // CVD 中性阈值（归一化后的斜率阈值）

  // --- 等高等低（Equal Highs / Lows）---
  readonly equalLevelTolerance: number;   // 价格容差比例（默认 0.001 = 0.1%）
  readonly equalLevelBonus: number;       // 命中等高等低区域时的评分加成（默认 12）
  readonly equalLevelMaxAgeDays: number;  // 等高等低区域最大有效期（天，默认 30）

  // --- 校准 ---
  readonly calibrationMinSampleSize: number;

  // --- 摩擦力参数 ---
  readonly baseSlippagePct: number;          // 基础滑点（默认 0.001 = 0.1%）
  readonly sessionSlippageMultiplier: number; // 低流动性时段滑点倍数（默认 2.5）

  // --- CSP 资本置换协议 ---
  readonly cspSwapThresholdTrend: number;         // 趋势市置换门槛（默认 1.1）
  readonly cspSwapThresholdRange: number;          // 震荡市置换门槛（默认 1.25）
  readonly cspSwapThresholdHighVolatility: number; // 高波动市置换门槛（默认 1.5）
  readonly cspSwapThresholdEventDriven: number;    // 事件驱动市（默认 999，禁止置换）
};

export const strategyConfig = {
  // --- 周期与数据 ---
  primaryTimeframe: "4h" as const,
  secondaryTimeframe: "1h" as const,
  marketDataLimit: 500,

  // --- 风险回报 ---
  minimumRiskReward: 2.5,
  riskPerTrade: env.RISK_PER_TRADE,
  accountSizeUsd: env.ACCOUNT_SIZE,

  // --- 市场状态 ---
  minRegimeConfidence: 60,
  eventDrivenOverrideScore: 80,
  highVolatilityOverrideScore: 75,
  minRegimeScoreGap: 10,
  trendExtensionAtrPenaltyThreshold: 2.0,

  // --- 参与者压力 ---
  minParticipantConfidence: 60,
  oiCollapseVacuumThresholdPercent: 0.1,
  basisDivergenceThreshold: 0.002,
  basisDivergenceConfidenceBoost: 12,

  // --- 结构触发 ---
  liquiditySweepConfirmationTimeframe: "4h" as const,
  minStructureScore: 60,
  minStructureScoreForWeakParticipantOverride: 75,
  confluenceBonus: 10,
  confirmationShadowRatio: 0.5,
  confirmationCandles: 2,
  requireCvdAlignmentForSweep: false,

  // --- 交易时段 ---
  enableSessionAdjustment: true,
  sessionDiscountFactor: 0.8,
  sessionPremiumFactor: 1.1,

  // --- 风控门槛 ---
  maxStopDistanceAtr: 2.5,
  maxCorrelatedSignalsPerDirection: 2,
  maxSameDirectionOpenRiskPercent: 0.02,
  maxPortfolioOpenRiskPercent: 0.03,

  // --- 事件与语义 ---
  recentEventWatchWindowHours: 12,
  minimumMacroConfidence: 7,
  minimumBtcRelevance: 6,
  allowEventDrivenSignals: false,
  maxNewsItemsForPrompt: 10,

  // --- 日线趋势过滤（Volume Profile）---
  dailyDataLimit: 100,          // 拉取 100 根日线（持久化缓存）
  vpLookbackDays: 30,           // 用最近 30 根日线计算 VP（≈ 1 个月）
  vpBucketCount: 200,           // 200 个等宽价格桶
  vpValueAreaPercent: 0.70,     // 价值区间覆盖 70% 成交量（Market Profile 惯例）
  cvdWindow: 20,                // 最近 20 根 4h K 线用于订单流动量对比
  cvdNeutralThreshold: 0.05,    // 归一化斜率落在 ±5% 内视为中性

  // --- 等高等低（Equal Highs / Lows）---
  equalLevelTolerance: 0.001,  // 0.1% 容差（BTC@50k ≈ ±50 USDT）
  equalLevelBonus: 12,         // 高于 confluenceBonus(10)，体现更高密度止损聚集
  equalLevelMaxAgeDays: 30,    // 超过 30 天未触碰的等高等低不参与加成评分

  // --- 校准 ---
  calibrationMinSampleSize: 50,

  // --- 摩擦力参数 ---
  baseSlippagePct: 0.001,
  sessionSlippageMultiplier: 2.5,

  // --- CSP 资本置换协议 ---
  cspSwapThresholdTrend: 1.1,
  cspSwapThresholdRange: 1.25,
  cspSwapThresholdHighVolatility: 1.5,
  cspSwapThresholdEventDriven: 999,
} as const satisfies StrategyConfig;

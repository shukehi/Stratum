/**
 * StrategyConfig は明示的な型定義を持つ。
 * boolean / number フィールドは widened 型（テスト時のオーバーライドを許容）。
 * 文字列 union 型（timeframe）は具体的な値を保持する。
 *
 * strategyConfig は `as const satisfies StrategyConfig` で定義することで
 * リテラル型（literal inference）を維持しつつ、型の互換性チェックも保証する。
 */
export type StrategyConfig = {
  // --- 周期与数据 ---
  readonly primaryTimeframe: "4h";
  readonly secondaryTimeframe: "1h";
  readonly marketDataLimit: number;

  // --- 风险回报 ---
  readonly minimumRiskReward: number;
  readonly riskPerTrade: number;

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

  // --- 交易时段 ---
  readonly enableSessionAdjustment: boolean;
  readonly sessionDiscountFactor: number;
  readonly sessionPremiumFactor: number;

  // --- 风控门槛 ---
  readonly maxStopDistanceAtr: number;
  readonly maxCorrelatedSignalsPerDirection: number;

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

  // --- 等高等低（Equal Highs / Lows）---
  readonly equalLevelTolerance: number;   // 价格容差比例（默认 0.001 = 0.1%）
  readonly equalLevelBonus: number;       // 命中等高等低区域时的评分加成（默认 12）
  readonly equalLevelMaxAgeDays: number;  // 等高等低区域最大有效期（天，默认 30）

  // --- 校准 ---
  readonly calibrationMinSampleSize: number;
};

export const strategyConfig = {
  // --- 周期与数据 ---
  primaryTimeframe: "4h" as const,
  secondaryTimeframe: "1h" as const,
  marketDataLimit: 500,

  // --- 风险回报 ---
  minimumRiskReward: 2.5,
  riskPerTrade: 0.01,

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

  // --- 交易时段 ---
  enableSessionAdjustment: true,
  sessionDiscountFactor: 0.8,
  sessionPremiumFactor: 1.1,

  // --- 风控门槛 ---
  maxStopDistanceAtr: 2.5,
  maxCorrelatedSignalsPerDirection: 2,

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

  // --- 等高等低（Equal Highs / Lows）---
  equalLevelTolerance: 0.001,  // 0.1% 容差（BTC@50k ≈ ±50 USDT）
  equalLevelBonus: 12,         // 高于 confluenceBonus(10)，体现更高密度止损聚集
  equalLevelMaxAgeDays: 30,    // 超过 30 天未触碰的等高等低不参与加成评分

  // --- 校准 ---
  calibrationMinSampleSize: 50,
} as const satisfies StrategyConfig;

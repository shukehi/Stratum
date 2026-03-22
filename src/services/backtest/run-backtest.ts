import type { Candle } from "../../domain/market/candle.js";
import type { FundingRatePoint } from "../../domain/market/funding-rate.js";
import type { OpenInterestPoint } from "../../domain/market/open-interest.js";
import type { NewsItem } from "../../domain/news/news-item.js";
import type { DailyBias } from "../../domain/market/daily-bias.js";
import type { OrderFlowBias } from "../../domain/market/order-flow.js";
import type { ReasonCode } from "../../domain/common/reason-code.js";
import type { StrategyConfig } from "../../app/config.js";
import type {
  BacktestSignal,
  BacktestTrade,
  BacktestTradeStatus,
} from "../../domain/backtest/backtest-types.js";
import type { MarketContext } from "../../domain/market/market-context.js";
import type { EqualLevel } from "../../domain/market/equal-level.js";
import type { LlmCallFn } from "../macro/assess-macro-overlay.js";
import { analyzeStructuralSetups, detectStructuralSetups } from "../structure/detect-structural-setups.js";
import { detectEqualHighs, detectEqualLows } from "../structure/detect-equal-levels.js";
import { detectMarketRegime } from "../regime/detect-market-regime.js";
import { assessParticipantPressure } from "../participants/assess-participant-pressure.js";
import { buildMarketContext } from "../participants/build-market-context.js";
import { isTradableContext } from "../participants/is-tradable-context.js";
import { detectDailyBias } from "../regime/detect-daily-bias.js";
import { detectOrderFlowBias } from "../analysis/compute-cvd.js";
import { analyzeConsensus, evaluateConsensus } from "../consensus/evaluate-consensus.js";
import { assessMacroOverlay } from "../macro/assess-macro-overlay.js";
import { applyMacroOverlay } from "../macro/apply-macro-overlay.js";
import { detectLiquiditySession } from "../../utils/session.js";
import { evaluateExposureGate } from "../risk/evaluate-exposure-gate.js";

export type SpotPricePoint = {
  timestamp: number;
  price: number;
};

export type FullChainBacktestRecord = {
  signal: BacktestSignal;
  alertStatus:
    | "blocked_by_macro"
    | "skipped_execution_gate"
    | "skipped_duplicate"
    | "sent";
  macroAction: "pass" | "downgrade" | "block";
  confirmationStatus: "pending" | "confirmed" | "invalidated";
  regime: MarketContext["regime"];
  participantPressureType: MarketContext["participantPressureType"];
  basisDivergence: boolean;
  dailyBias?: DailyBias;
  orderFlowBias?: OrderFlowBias;
  skipStage?: "context_gate" | "structure" | "consensus" | "macro";
  skipReasonCode?: ReasonCode;
  executionReasonCode?: string;
};

export type FullChainBacktestInput = {
  symbol: string;
  candles4h: Candle[];
  candles1h: Candle[];
  candles1d: Candle[];
  fundingRates: FundingRatePoint[];
  openInterest: OpenInterestPoint[];
  spotPrice?: number;
  spotPrices?: SpotPricePoint[];
  news: NewsItem[];
  config: StrategyConfig;
  llmCall: LlmCallFn;
  minHistory?: number;
};

/**
 * 回测引擎  (PHASE_10-C)
 *
 * 设计分为两部分：
 *   1. `generateBacktestSignals`：按时间向前推进，逐步检测结构信号；
 *   2. `runBacktest`：接收信号列表，按后续 K 线逐笔模拟交易结果。
 *
 * 入场价格采用保守最差成交假设：
 *   - 做多用 `entryHigh`；
 *   - 做空用 `entryLow`。
 *
 * 出场判定按每根后续 K 线顺序检查：
 *   - 做多：`low <= stopLoss` 先判止损，`high >= takeProfit` 判止盈；
 *   - 做空：`high >= stopLoss` 先判止损，`low <= takeProfit` 判止盈；
 *   - 同一根 K 线同时触发 TP/SL 时，优先按 SL 处理。
 */

// ── Walk-forward 信号生成 ──────────────────────────────────────────────────

/**
 * 以 walk-forward 方式生成回测信号。
 *
 * 在每个 4h 边界只使用“当时已经可见”的数据执行结构检测，
 * 从而尽量贴近实时扫描的因果顺序。
 *
 * 这里会绕过宏观、状态和参与者硬门槛，只测试结构检测本身的产出能力。
 * 去重规则为：相同 `(direction, entryHigh)` 组合只保留一次。
 */
export function generateBacktestSignals(
  candles4h: Candle[],
  candles1h: Candle[],
  config: StrategyConfig,
  minHistory = 50
): BacktestSignal[] {
  const signals: BacktestSignal[] = [];
  const seenKeys = new Set<string>();

  // 修复 5：把等高等低检测提到循环外，避免每次迭代重复执行 O(n log n) 排序
  // 注：使用全量 candles4h 预计算，存在轻微前视偏差（future swings included）；
  // 对价格结构型区域影响可忽略，换取 O(n²) → O(n²/n log n) 的回测性能提升。
  const precomputedEqualLevels: EqualLevel[] = [
    ...detectEqualHighs(candles4h, config.equalLevelTolerance),
    ...detectEqualLows(candles4h, config.equalLevelTolerance),
  ];

  // 构造一个中性 MarketContext，专门用于绕过状态层和参与者层门槛
  const neutralCtx: MarketContext = {
    regime: "trend",
    regimeConfidence: 1,
    regimeReasons: [],
    participantBias: "balanced",
    participantPressureType: "none",
    participantConfidence: 1,
    participantRationale: "",
    spotPerpBasis: 0,
    basisDivergence: false,
    liquiditySession: "ny_close",
    summary: "backtest-neutral",
    reasonCodes: [],
  };

  for (let i = minHistory; i < candles4h.length; i++) {
    const slice4h = candles4h.slice(0, i + 1);
    const setups = detectStructuralSetups(slice4h, candles1h, neutralCtx, config, precomputedEqualLevels);

    for (const setup of setups) {
      if (setup.confirmationStatus === "invalidated") continue;

      const key = `${setup.direction}_${Math.floor(setup.entryHigh)}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      signals.push({
        candleIndex: i,
        direction: setup.direction,
        entryHigh: setup.entryHigh,
        entryLow: setup.entryLow,
        stopLoss: setup.stopLossHint,
        takeProfit: setup.takeProfitHint,
        structureScore: setup.structureScore,
        structureReason: setup.structureReason,
      });
    }
  }

  return signals;
}

/**
 * 按实时执行顺序重放完整因果链，并保留 pass / downgrade / block 样本。
 */
export async function generateFullChainBacktestSignals(
  input: FullChainBacktestInput
): Promise<FullChainBacktestRecord[]> {
  const {
    symbol,
    candles4h,
    candles1h,
    candles1d,
    fundingRates,
    openInterest,
    spotPrice,
    spotPrices = [],
    news,
    config,
    llmCall,
    minHistory = 50,
  } = input;

  const records: FullChainBacktestRecord[] = [];
  const sentKeys = new Set<string>();
  const openExposures: Array<{
    direction: "long" | "short";
    entryLow: number;
    entryHigh: number;
    stopLoss: number;
    takeProfit: number;
    accountRiskPercent: number;
  }> = [];
  for (let i = minHistory; i < candles4h.length; i++) {
    const current4h = candles4h[i];
    pruneClosedExposures(openExposures, current4h);
    const slice4h = candles4h.slice(0, i + 1);
    const slice1h = candles1h.filter((candle) => candle.timestamp <= current4h.timestamp);
    const slice1d = candles1d.filter((candle) => candle.timestamp <= current4h.timestamp);
    const fundingSlice = fundingRates.filter((point) => point.timestamp <= current4h.timestamp);
    const oiSlice = openInterest.filter((point) => point.timestamp <= current4h.timestamp);
    const historicalSpotPrice =
      resolveSpotPrice(spotPrices, current4h.timestamp) ??
      current4h.close ??
      spotPrice ??
      0;
    const newsSlice = news.filter(
      (item) => Date.parse(item.publishedAt) <= current4h.timestamp
    );

    const dailyBiasResult =
      slice1d.length >= config.vpLookbackDays
        ? detectDailyBias(
            slice1d,
            config.vpLookbackDays,
            config.vpBucketCount,
            config.vpValueAreaPercent,
          )
        : null;
    const orderFlowResult = detectOrderFlowBias(
      slice4h,
      config.cvdWindow,
      config.cvdNeutralThreshold
    );
    const regimeDecision = detectMarketRegime(slice4h, config, {
      fundingRates: fundingSlice,
      openInterest: oiSlice,
      spotPrice: historicalSpotPrice,
    });
    const pressure = assessParticipantPressure(
      slice4h,
      fundingSlice,
      oiSlice,
      historicalSpotPrice,
      config
    );
    const session = detectLiquiditySession(new Date(current4h.timestamp).getUTCHours());
    const ctx = buildMarketContext(regimeDecision, pressure, session);
    const tradable = isTradableContext(ctx, config);

    if (!tradable.tradable) {
      continue;
    }

    const precomputedEqualLevels: EqualLevel[] = [
      ...detectEqualHighs(slice4h, config.equalLevelTolerance),
      ...detectEqualLows(slice4h, config.equalLevelTolerance),
    ];

    const structuralAnalysis = analyzeStructuralSetups(
      slice4h,
      slice1h,
      ctx,
      config,
      precomputedEqualLevels
    );
    const setups = structuralAnalysis.setups;
    if (setups.length === 0) continue;

    const baselineWindow = slice4h.slice(-50);
    const baselineAtr =
      baselineWindow.length > 0
        ? baselineWindow.reduce((sum, c) => sum + (c.high - c.low), 0) / baselineWindow.length
        : 0;

    const consensusAnalysis = analyzeConsensus({
      symbol,
      setups,
      ctx,
      config,
      baselineAtr,
      openLongCount: openExposures.filter((exposure) => exposure.direction === "long").length,
      openShortCount: openExposures.filter((exposure) => exposure.direction === "short").length,
      openLongRiskPercent: openExposures
        .filter((exposure) => exposure.direction === "long")
        .reduce((sum, exposure) => sum + exposure.accountRiskPercent, 0),
      openShortRiskPercent: openExposures
        .filter((exposure) => exposure.direction === "short")
        .reduce((sum, exposure) => sum + exposure.accountRiskPercent, 0),
      portfolioOpenRiskPercent: openExposures
        .reduce((sum, exposure) => sum + exposure.accountRiskPercent, 0),
      dailyBias: dailyBiasResult?.bias,
      orderFlowBias: orderFlowResult.bias,
    });
    const candidates = consensusAnalysis.candidates;
    if (candidates.length === 0) continue;

    for (const candidate of candidates) {
      const { decision } = await assessMacroOverlay(newsSlice, candidate, config, llmCall);
      const filtered = applyMacroOverlay([candidate], decision);
      const sameDirectionExposureCount = openExposures.filter(
        (exposure) => exposure.direction === candidate.direction
      ).length;
      const sameDirectionOpenRiskPercent = openExposures
        .filter((exposure) => exposure.direction === candidate.direction)
        .reduce((sum, exposure) => sum + exposure.accountRiskPercent, 0);
      const portfolioOpenRiskPercent = openExposures
        .reduce((sum, exposure) => sum + exposure.accountRiskPercent, 0);
      const signal: BacktestSignal = {
        candleIndex: i,
        direction: candidate.direction,
        entryHigh: candidate.entryHigh,
        entryLow: candidate.entryLow,
        stopLoss: candidate.stopLoss,
        takeProfit: candidate.takeProfit,
        structureScore: inferStructureScore(candidate),
        structureReason: candidate.structureReason,
      };

      const key = `${candidate.direction}_${Math.floor(candidate.entryHigh)}`;
      const record: FullChainBacktestRecord = {
        signal,
        alertStatus: decision.action === "block" ? "blocked_by_macro" : "sent",
        macroAction: decision.action,
        confirmationStatus: inferConfirmationStatus(candidate.reasonCodes),
        regime: ctx.regime,
        participantPressureType: ctx.participantPressureType,
        basisDivergence: ctx.basisDivergence,
        dailyBias: dailyBiasResult?.bias,
        orderFlowBias: orderFlowResult.bias,
        skipStage: filtered.length === 0 ? "macro" : undefined,
        skipReasonCode: filtered.length === 0 ? "MACRO_BLOCKED" : undefined,
        executionReasonCode: filtered.length === 0 ? "MACRO_BLOCKED" : undefined,
      };
      records.push(record);

      if (sentKeys.has(key)) {
        record.alertStatus = "skipped_duplicate";
        record.executionReasonCode = "already_sent";
        continue;
      }

      if (filtered.length > 0) {
        const exposureGate = evaluateExposureGate({
          sameDirectionExposureCount,
          sameDirectionOpenRiskPercent,
          portfolioOpenRiskPercent,
          config,
        });
        if (!exposureGate.allowed) {
          record.alertStatus = "skipped_execution_gate";
          record.skipStage = "consensus";
          record.skipReasonCode = exposureGate.reasonCode;
          record.executionReasonCode = exposureGate.reasonCode;
          continue;
        }

        openExposures.push({
          direction: candidate.direction,
          entryLow: candidate.entryLow,
          entryHigh: candidate.entryHigh,
          stopLoss: candidate.stopLoss,
          takeProfit: candidate.takeProfit,
          accountRiskPercent: config.riskPerTrade,
        });
        sentKeys.add(key);
      }
    }
  }

  return records;
}

// ── 交易模拟 ────────────────────────────────────────────────────────────────

/**
 * 按给定 K 线序列逐笔模拟交易，返回 `BacktestTrade[]`。
 *
 * 每笔交易都从其入场触发那根 K 线的下一根开始检查。
 * 若直到数据尾部仍未触发平仓，则记为 `expired`。
 */
export function runBacktest(
  signals: BacktestSignal[],
  candles: Candle[]
): BacktestTrade[] {
  return signals.map((signal) => simulateTrade(signal, candles));
}

// ── 内部实现 ────────────────────────────────────────────────────────────────

function simulateTrade(signal: BacktestSignal, candles: Candle[]): BacktestTrade {
  const entryPrice =
    signal.direction === "long" ? signal.entryHigh : signal.entryLow;

  const entryMid = (signal.entryLow + signal.entryHigh) / 2;
  const risk = Math.abs(entryMid - signal.stopLoss);

  // 从入场触发后的下一根 K 线开始扫描
  const scanStart = signal.candleIndex + 1;

  for (let i = scanStart; i < candles.length; i++) {
    const c = candles[i];

    if (signal.direction === "long") {
      const slHit = c.low <= signal.stopLoss;
      const tpHit = c.high >= signal.takeProfit;

      if (slHit || tpHit) {
        // 同一根 K 线同时命中止盈止损时，优先按止损处理
        const status: BacktestTradeStatus = slHit ? "closed_sl" : "closed_tp";
        const exitPrice = slHit ? signal.stopLoss : signal.takeProfit;
        const pnlR = risk > 0 ? (exitPrice - entryMid) / risk : 0;
        return { signal, entryPrice, exitPrice, exitCandleIndex: i, status, pnlR };
      }
    } else {
      const slHit = c.high >= signal.stopLoss;
      const tpHit = c.low <= signal.takeProfit;

      if (slHit || tpHit) {
        const status: BacktestTradeStatus = slHit ? "closed_sl" : "closed_tp";
        const exitPrice = slHit ? signal.stopLoss : signal.takeProfit;
        const pnlR = risk > 0 ? (entryMid - exitPrice) / risk : 0;
        return { signal, entryPrice, exitPrice, exitCandleIndex: i, status, pnlR };
      }
    }
  }

  // 到达数据尾部仍未出场时，按最后一根收盘价强制结算
  const lastCandle = candles[candles.length - 1];
  const exitPrice = lastCandle?.close ?? entryPrice;
  const pnlR =
    risk > 0
      ? signal.direction === "long"
        ? (exitPrice - entryMid) / risk
        : (entryMid - exitPrice) / risk
      : 0;

  return {
    signal,
    entryPrice,
    exitPrice,
    exitCandleIndex: candles.length - 1,
    status: "expired",
    pnlR,
  };
}

function inferStructureScore(candidate: { signalGrade: string }): number {
  if (candidate.signalGrade === "high-conviction") return 85;
  if (candidate.signalGrade === "standard") return 70;
  return 55;
}

function inferConfirmationStatus(
  reasonCodes: ReasonCode[]
): "pending" | "confirmed" | "invalidated" {
  if (reasonCodes.includes("STRUCTURE_CONFIRMATION_INVALIDATED")) return "invalidated";
  if (reasonCodes.includes("STRUCTURE_CONFIRMATION_PENDING")) return "pending";
  return "confirmed";
}

function pruneClosedExposures(
  exposures: Array<{
    direction: "long" | "short";
    entryLow: number;
    entryHigh: number;
    stopLoss: number;
    takeProfit: number;
    accountRiskPercent: number;
  }>,
  candle: Candle
): void {
  for (let i = exposures.length - 1; i >= 0; i--) {
    const exposure = exposures[i];
    const closed =
      exposure.direction === "long"
        ? candle.low <= exposure.stopLoss || candle.high >= exposure.takeProfit
        : candle.high >= exposure.stopLoss || candle.low <= exposure.takeProfit;
    if (closed) exposures.splice(i, 1);
  }
}

function resolveSpotPrice(
  spotPrices: SpotPricePoint[],
  timestamp: number
): number | undefined {
  let latest: number | undefined;
  for (const point of spotPrices) {
    if (point.timestamp > timestamp) break;
    latest = point.price;
  }
  return latest;
}

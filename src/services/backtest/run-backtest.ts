import type { Candle } from "../../domain/market/candle.js";
import type { FundingRatePoint } from "../../domain/market/funding-rate.js";
import type { OpenInterestPoint } from "../../domain/market/open-interest.js";
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
import { analyzeStructuralSetups, detectStructuralSetups } from "../structure/detect-structural-setups.js";
import { detectEqualHighs, detectEqualLows } from "../structure/detect-equal-levels.js";
import { detectMarketRegime } from "../regime/detect-market-regime.js";
import { assessParticipantPressure } from "../participants/assess-participant-pressure.js";
import { buildMarketContext } from "../participants/build-market-context.js";
import { isTradableContext } from "../participants/is-tradable-context.js";
import { detectDailyBias } from "../regime/detect-daily-bias.js";
import { detectOrderFlowBias } from "../analysis/compute-cvd.js";
import { analyzeConsensus } from "../consensus/evaluate-consensus.js";
import { detectLiquiditySession } from "../../utils/session.js";
import { evaluateExposureGate } from "../risk/evaluate-exposure-gate.js";

export type SpotPricePoint = {
  timestamp: number;
  price: number;
};

export type FullChainBacktestRecord = {
  signal: BacktestSignal;
  alertStatus:
    | "skipped_execution_gate"
    | "skipped_duplicate"
    | "sent";
  confirmationStatus: "pending" | "confirmed" | "invalidated";
  regime: MarketContext["regime"];
  participantPressureType: MarketContext["participantPressureType"];
  basisDivergence: boolean;
  dailyBias?: DailyBias;
  orderFlowBias?: OrderFlowBias;
  skipStage?: "context_gate" | "structure" | "consensus";
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
  config: StrategyConfig;
  minHistory?: number;
};

/**
 * 回测引擎  (PHASE_10-C)
 *
 * 设计分为两部分：
 *   1. `generateBacktestSignals`：按时间向前推进，逐步检测结构信号；
 *   2. `runBacktest`：接收信号列表，按后续 K 线逐笔模拟交易结果。
 */

// ── Walk-forward 信号生成 ──────────────────────────────────────────────────

/**
 * 以 walk-forward 方式生成回测信号。
 */
export function generateBacktestSignals(
  candles4h: Candle[],
  candles1h: Candle[],
  config: StrategyConfig,
  minHistory = 50,
  precomputedEqualLevels?: EqualLevel[]
): BacktestSignal[] {
  const signals: BacktestSignal[] = [];
  const seenKeys = new Set<string>();

  const neutralCtx: MarketContext = {
    regime: "range",
    regimeConfidence: 1,
    marketDriverType: "organic",
    participantBias: "neutral",
    participantPressureType: "balanced",
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
 * 按实时执行顺序重放完整因果链。
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
    config,
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
    const slice1h = candles1h.filter((c) => c.timestamp <= current4h.timestamp);
    const slice1d = candles1d.filter((c) => c.timestamp <= current4h.timestamp);
    const fundingSlice = fundingRates.filter((f) => f.timestamp <= current4h.timestamp);
    const oiSlice = openInterest.filter((o) => o.timestamp <= current4h.timestamp);
    const historicalSpotPrice =
      resolveSpotPrice(spotPrices, current4h.timestamp) ??
      current4h.close ??
      spotPrice ??
      0;

    const dailyBiasResult =
      slice1d.length >= config.vpLookbackDays
        ? detectDailyBias(slice1d, config.vpLookbackDays, config.vpBucketCount, config.vpValueAreaPercent)
        : null;

    const orderFlowResult = detectOrderFlowBias(slice4h, config.cvdWindow, config.cvdNeutralThreshold);
    const regimeDecision = detectMarketRegime(slice4h, config, {
      fundingRates: fundingSlice,
      openInterest: oiSlice,
      spotPrice: historicalSpotPrice,
    });
    const pressure = assessParticipantPressure(slice4h, fundingSlice, oiSlice, historicalSpotPrice, config);
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

    const structuralAnalysis = analyzeStructuralSetups(slice4h, slice1h, ctx, config, precomputedEqualLevels);
    const setups = structuralAnalysis.setups;
    if (setups.length === 0) continue;

    const baselineAtr = slice4h.slice(-50).reduce((s, c) => s + (c.high - c.low), 0) / 50;

    const consensusAnalysis = analyzeConsensus({
      symbol, setups, ctx, config, baselineAtr,
      openLongCount: openExposures.filter(e => e.direction === 'long').length,
      openShortCount: openExposures.filter(e => e.direction === 'short').length,
      openLongRiskPercent: openExposures.filter(e => e.direction === 'long').reduce((s, e) => s + e.accountRiskPercent, 0),
      openShortRiskPercent: openExposures.filter(e => e.direction === 'short').reduce((s, e) => s + e.accountRiskPercent, 0),
      portfolioOpenRiskPercent: openExposures.reduce((s, e) => s + e.accountRiskPercent, 0),
      dailyBias: dailyBiasResult?.bias,
      orderFlowBias: orderFlowResult.bias,
    });

    for (const candidate of consensusAnalysis.candidates) {
      const exposureGate = evaluateExposureGate({
        sameDirectionExposureCount: openExposures.filter(e => e.direction === candidate.direction).length,
        sameDirectionOpenRiskPercent: openExposures.filter(e => e.direction === candidate.direction).reduce((s, e) => s + e.accountRiskPercent, 0),
        portfolioOpenRiskPercent: openExposures.reduce((s, e) => s + e.accountRiskPercent, 0),
        config,
      });

      if (!exposureGate.allowed) {
        records.push({
          signal: candidate as BacktestSignal,
          alertStatus: "skipped_execution_gate",
          confirmationStatus: "confirmed",
          regime: ctx.regime,
          participantPressureType: ctx.participantPressureType,
          basisDivergence: ctx.basisDivergence,
          dailyBias: dailyBiasResult?.bias,
          orderFlowBias: orderFlowResult.bias,
          executionReasonCode: exposureGate.reasonCode,
        });
        continue;
      }

      const key = `${candidate.direction}_${Math.floor(candidate.entryHigh)}`;
      if (sentKeys.has(key)) {
        records.push({
          signal: candidate as BacktestSignal,
          alertStatus: "skipped_duplicate",
          confirmationStatus: "confirmed",
          regime: ctx.regime,
          participantPressureType: ctx.participantPressureType,
          basisDivergence: ctx.basisDivergence,
          dailyBias: dailyBiasResult?.bias,
          orderFlowBias: orderFlowResult.bias,
          executionReasonCode: "already_sent",
        });
        continue;
      }

      sentKeys.add(key);
      records.push({
        signal: candidate as BacktestSignal,
        alertStatus: "sent",
        confirmationStatus: "confirmed",
        regime: ctx.regime,
        participantPressureType: ctx.participantPressureType,
        basisDivergence: ctx.basisDivergence,
        dailyBias: dailyBiasResult?.bias,
        orderFlowBias: orderFlowResult.bias,
      });

      openExposures.push({
        direction: candidate.direction,
        entryLow: candidate.entryLow,
        entryHigh: candidate.entryHigh,
        stopLoss: candidate.stopLoss,
        takeProfit: candidate.takeProfit,
        accountRiskPercent: config.riskPerTrade,
      });
    }
  }

  return records;
}

// ── 模拟下单与结果判定 ──────────────────────────────────────────────────────

/**
 * 接收一系列候选信号，模拟后续 K 线逐笔驱动，计算最终胜率和收益。
 */
export function runBacktest(
  signals: BacktestSignal[],
  candles4h: Candle[],
  config: StrategyConfig
): BacktestTrade[] {
  const trades: BacktestTrade[] = [];

  for (const signal of signals) {
    const trade = simulateTrade(signal, candles4h, config);
    if (trade) trades.push(trade);
  }

  return trades;
}

function simulateTrade(
  signal: BacktestSignal,
  candles4h: Candle[],
  config: StrategyConfig
): BacktestTrade | null {
  const { candleIndex, direction, entryHigh, entryLow, stopLoss, takeProfit } = signal;

  // 1. 保守入场判定：做多用 entryHigh，做空用 entryLow
  const entryPrice = direction === "long" ? entryHigh : entryLow;
  const openedAt = candles4h[candleIndex].timestamp;

  // 2. 模拟后续 K 线
  for (let j = candleIndex + 1; j < candles4h.length; j++) {
    const c = candles4h[j];

    if (direction === "long") {
      // 做多逻辑：先判 SL，后判 TP
      if (c.low <= stopLoss) {
        return finalizeTrade(signal, entryPrice, stopLoss, "closed_sl", openedAt, c.timestamp);
      }
      if (c.high >= takeProfit) {
        return finalizeTrade(signal, entryPrice, takeProfit, "closed_tp", openedAt, c.timestamp);
      }
    } else {
      // 做空逻辑：先判 SL，后判 TP
      if (c.high >= stopLoss) {
        return finalizeTrade(signal, entryPrice, stopLoss, "closed_sl", openedAt, c.timestamp);
      }
      if (c.low <= takeProfit) {
        return finalizeTrade(signal, entryPrice, takeProfit, "closed_tp", openedAt, c.timestamp);
      }
    }

    // 3. 时间过滤：若持仓过久（如 50 根 4h K 线），强制按收盘价平仓
    if (j - candleIndex > 50) {
      return finalizeTrade(signal, entryPrice, c.close, "closed_manual", openedAt, c.timestamp);
    }
  }

  return null;
}

function finalizeTrade(
  signal: BacktestSignal,
  entryPrice: number,
  exitPrice: number,
  status: BacktestTradeStatus,
  openedAt: number,
  closedAt: number
): BacktestTrade {
  const risk = Math.abs(entryPrice - signal.stopLoss);
  const pnlR = risk > 0
    ? signal.direction === "long"
      ? (exitPrice - entryPrice) / risk
      : (entryPrice - exitPrice) / risk
    : 0;

  return {
    ...signal,
    openedAt,
    closedAt,
    exitPrice,
    pnlR,
    status,
  };
}

// ── 内部辅助 ────────────────────────────────────────────────────────────────

function resolveSpotPrice(spotPrices: SpotPricePoint[], timestamp: number): number | undefined {
  return spotPrices.find((s) => s.timestamp === timestamp)?.price;
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
    const e = exposures[i];
    if (e.direction === "long") {
      if (candle.low <= e.stopLoss || candle.high >= e.takeProfit) {
        exposures.splice(i, 1);
      }
    } else {
      if (candle.high >= e.stopLoss || candle.low <= e.takeProfit) {
        exposures.splice(i, 1);
      }
    }
  }
}

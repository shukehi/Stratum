import type { ExchangeClient } from "../../clients/exchange/ccxt-client.js";
import type { HttpFetchFn } from "../alerting/send-alert.js";
import type { NotificationConfig } from "../alerting/send-notification.js";
import type { Candle } from "../../domain/market/candle.js";
import type { AlertPayload } from "../../domain/signal/alert-payload.js";
import type { TradeCandidate } from "../../domain/signal/trade-candidate.js";
import type { ReasonCode } from "../../domain/common/reason-code.js";
import type { DailyBias } from "../../domain/market/daily-bias.js";
import type { OrderFlowBias } from "../../domain/market/order-flow.js";
import type { StrategyConfig } from "../../app/config.js";
import Database from "better-sqlite3";
import { strategyConfig } from "../../app/config.js";
import { logger } from "../../app/logger.js";
import { fetchMarketData } from "../market-data/fetch-market-data.js";
import { fetchFundingRates } from "../market-data/fetch-funding-rates.js";
import { fetchOpenInterest } from "../market-data/fetch-open-interest.js";
import { detectMarketRegime } from "../regime/detect-market-regime.js";
import { assessParticipantPressure } from "../participants/assess-participant-pressure.js";
import { buildMarketContext } from "../participants/build-market-context.js";
import { isTradableContext } from "../participants/is-tradable-context.js";
import { analyzeStructuralSetups } from "../structure/detect-structural-setups.js";
import { analyzeConsensus } from "../consensus/evaluate-consensus.js";
import {
  buildId,
  markCandidateDeliveryStarted,
  markCandidateSnapshotDeliveryStarted,
  saveCandidate,
  saveCandidateSnapshot,
  updateCandidateSnapshotOutcome,
  updateAlertStatus,
} from "../persistence/save-candidate.js";
import { findCandidate } from "../persistence/load-candidates.js";
import { sendAlert } from "../alerting/send-alert.js";
import { getCurrentSession } from "../../utils/session.js";
import { saveScanLog } from "../persistence/save-scan-log.js";
import { saveCandles } from "../persistence/save-candles.js";
import { detectDailyBias } from "../regime/detect-daily-bias.js";
import { detectOrderFlowBias } from "../analysis/compute-cvd.js";
import { buildPositionSizingSummary } from "../risk/compute-position-size.js";
import { evaluateSwappingGate } from "../risk/evaluate-exposure-gate.js";
import { closePosition, getOpenPositions, getOpenRiskSummary, openPosition } from "../positions/track-position.js";
import { detectOiCrash } from "../analysis/detect-oi-crash.js";

/**
 * 信号扫描工作流编排器  (PHASE_09 - V3 Physics Refactor)
 */

export type ScanDeps = {
  client: ExchangeClient;
  db: Database.Database;
  httpFetch?: HttpFetchFn;
  notificationConfig: NotificationConfig;
};

export type SignalScanResult = {
  symbol: string;
  scannedAt: number;
  candidatesFound: number;
  alertsSent: number;
  alertsFailed: number;
  alertsSkipped: number;
  regime?: string;
  participantPressureType?: string;
  dailyBias?: DailyBias;
  orderFlowBias?: OrderFlowBias;
  basisDivergence?: boolean;
  marketDriverType?: string;
  liquiditySession?: string;
  errors: string[];
  skipStage?: "context_gate" | "structure" | "consensus";
  skipReasonCode?: ReasonCode;
  /** OI 感应层物理动能索引 (3-Sigma crashIndex)，负值越大代表能量释放越强 */
  oiCrashIndex?: number;
  oiIsCrash?: boolean;
};

export async function runSignalScan(
  symbol: string,
  spotSymbol: string,
  deps: ScanDeps,
  config: StrategyConfig = strategyConfig
): Promise<SignalScanResult> {
  const { client, db, notificationConfig, httpFetch } = deps;
  const scannedAt = Date.now();
  const errors: string[] = [];

  logger.info({ symbol }, "V3 Physics Scan: Started");

  // 1. [并行] 市场数据获取
  const [candles4h, candles1h, candles1d, fundingRates, openInterest, spotTicker] =
    await Promise.all([
      fetchMarketData(client, symbol, "4h", config.marketDataLimit),
      fetchMarketData(client, symbol, "1h", config.marketDataLimit),
      fetchMarketData(client, symbol, "1d", config.dailyDataLimit).catch(() => [] as Candle[]),
      fetchFundingRates(client, symbol, 10),
      fetchOpenInterest(client, symbol, 50), // 增加 OI 窗口用于 3-Sigma 计算
      client.fetchSpotTicker(spotSymbol),
    ]);

  saveCandles(db, symbol, "4h", candles4h);
  saveCandles(db, symbol, "1h", candles1h);

  // ── [感应层] OI 3-Sigma 物理动能检测 ──────────────────────────────────────
  // 显式执行，使感应层成为流水线中真实存在的门控节点，而非隐式嵌入结构检测内部。
  const oiCrashResult = detectOiCrash(openInterest, candles4h.map(c => c.close));
  logger.info(
    { symbol, crashIndex: oiCrashResult.crashIndex.toFixed(2), isCrash: oiCrashResult.isCrash },
    `Physics Sensing Layer: ${oiCrashResult.reason}`
  );

  const dailyBiasResult = detectDailyBias(candles1d, config.vpLookbackDays, config.vpBucketCount, config.vpValueAreaPercent);
  const orderFlowResult = detectOrderFlowBias(candles4h, config.cvdWindow, config.cvdNeutralThreshold);
  const baselineAtr = candles4h.slice(-50).reduce((s, c) => s + (c.high - c.low), 0) / 50;

  // 2. 状态识别
  const regimeDecision = detectMarketRegime(candles4h, config, {
    fundingRates, openInterest, spotPrice: spotTicker.last
  });
  const pressure = assessParticipantPressure(candles4h, fundingRates, openInterest, spotTicker.last, config);
  const session = getCurrentSession();
  const ctx = buildMarketContext(regimeDecision, pressure, session);

  if (!isTradableContext(ctx, config).tradable) {
    const res = createEmptyResult(symbol, scannedAt, ctx, dailyBiasResult, orderFlowResult, errors);
    res.skipStage = "context_gate";
    saveScanLog(db, res);
    return res;
  }

  // 3. 结构检测 (V3 PHYSICS ENFORCED)
  const structuralAnalysis = analyzeStructuralSetups(candles4h, candles1h, ctx, config, openInterest);
  if (structuralAnalysis.setups.length === 0) {
    const res = createEmptyResult(symbol, scannedAt, ctx, dailyBiasResult, orderFlowResult, errors);
    res.skipStage = "structure";
    res.skipReasonCode = structuralAnalysis.skipReasonCode;
    saveScanLog(db, res);
    return res;
  }

  // 4. 共识与 CVS 计算
  const consensusAnalysis = analyzeConsensus({
    symbol, setups: structuralAnalysis.setups, ctx, config, baselineAtr,
    dailyBias: dailyBiasResult?.bias, orderFlowBias: orderFlowResult.bias,
    equalLevels: structuralAnalysis.equalLevels
  });

  const candidates = consensusAnalysis.candidates;
  if (candidates.length === 0) {
    const res = createEmptyResult(symbol, scannedAt, ctx, dailyBiasResult, orderFlowResult, errors);
    res.skipStage = "consensus";
    res.skipReasonCode = consensusAnalysis.skipReasonCode;
    saveScanLog(db, res);
    return res;
  }

  // 5. 资本置换与点火
  let alertsSent = 0;
  let alertsFailed = 0;
  let alertsSkipped = 0;
  const openPositions = getOpenPositions(db);

  for (const candidate of candidates) {
    const portfolioExposure = getOpenRiskSummary(db);
    const swappingDecision = evaluateSwappingGate({
      candidate,
      openPositions,
      portfolioOpenRiskPercent: portfolioExposure.openRiskPercent,
      config,
      currentRegime: ctx.regime,
      regimeConfidence: ctx.regimeConfidence
    });

    if (swappingDecision.action === "block") {
      alertsSkipped++;
      continue;
    }

    if (swappingDecision.action === "allow_swap") {
      const target = openPositions.find(p => p.id === swappingDecision.targetPositionId);
      if (target) {
        logger.info({ swapOut: target.id, swapIn: candidate.symbol }, swappingDecision.reason);
        closePosition(db, target.symbol, target.direction, target.timeframe, target.entryHigh, target.entryHigh, "closed_manual");
      }
    }

    const positionSizing = buildPositionSizingSummary({
      candidate, config, 
      sameDirectionExposureCount: openPositions.filter(p => p.direction === candidate.direction).length,
      sameDirectionOpenRiskPercent: 0,
      portfolioOpenRiskPercent: portfolioExposure.openRiskPercent
    });

    const payload: AlertPayload = { candidate, marketContext: ctx, alertStatus: "sent", createdAt: scannedAt };
    const snapshotId = saveCandidateSnapshot(db, payload, {
      confirmationStatus: inferConfirmationStatus(candidate.reasonCodes),
      dailyBias: dailyBiasResult?.bias,
      orderFlowBias: orderFlowResult.bias,
      positionSizing,
      executionOutcome: "sent"
    });

    saveCandidate(db, payload, {
      confirmationStatus: inferConfirmationStatus(candidate.reasonCodes),
      dailyBias: dailyBiasResult?.bias,
      orderFlowBias: orderFlowResult.bias,
      positionSizing
    });

    // FSD: 执行静默发报与拦截判定
    const ok = await sendAlert(payload, notificationConfig, httpFetch, { positionSizing });
    const finalStatus = "sent"; // FSD 模式下，无论静默与否，逻辑状态均为已发送/已执行
    const deliveryCompletedAt = Date.now();

    db.transaction(() => {
      updateAlertStatus(db, candidate.symbol, candidate.direction, candidate.timeframe, candidate.entryHigh, finalStatus, { deliveryCompletedAt });
      updateCandidateSnapshotOutcome(db, snapshotId, finalStatus, { alertStatus: finalStatus, deliveryCompletedAt });
      // 在 FSD 模式下，必定触发开仓（自动驾驶闭环）
      openPosition(db, candidate, scannedAt, {
        recommendedPositionSize: positionSizing.recommendedPositionSize,
        riskAmount: positionSizing.riskAmount,
        accountRiskPercent: positionSizing.accountRiskPercent
      });
    })();

    if (ok) alertsSent++;
  }

  const finalResult: SignalScanResult = {
    symbol, scannedAt, candidatesFound: candidates.length,
    alertsSent, alertsFailed, alertsSkipped,
    regime: ctx.regime, participantPressureType: ctx.participantPressureType,
    dailyBias: dailyBiasResult?.bias, orderFlowBias: orderFlowResult.bias,
    basisDivergence: ctx.basisDivergence, marketDriverType: ctx.marketDriverType,
    liquiditySession: ctx.liquiditySession,
    oiCrashIndex: oiCrashResult.crashIndex,
    oiIsCrash: oiCrashResult.isCrash,
    errors
  };
  saveScanLog(db, finalResult);
  return finalResult;
}

function createEmptyResult(symbol: string, scannedAt: number, ctx: any, dailyBias: any, orderFlow: any, errors: string[]): SignalScanResult {
  return {
    symbol, scannedAt, candidatesFound: 0, alertsSent: 0, alertsFailed: 0, alertsSkipped: 0,
    regime: ctx.regime, participantPressureType: ctx.participantPressureType,
    dailyBias: dailyBias?.bias, orderFlowBias: orderFlow.bias,
    basisDivergence: ctx.basisDivergence, marketDriverType: ctx.marketDriverType,
    liquiditySession: ctx.liquiditySession, errors
  };
}

function inferConfirmationStatus(reasonCodes: ReasonCode[]): "pending" | "confirmed" | "invalidated" {
  if (reasonCodes.includes("STRUCTURE_CONFIRMATION_INVALIDATED")) return "invalidated";
  if (reasonCodes.includes("STRUCTURE_CONFIRMATION_PENDING")) return "pending";
  return "confirmed";
}

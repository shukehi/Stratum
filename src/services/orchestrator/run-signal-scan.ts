import type { ExchangeClient } from "../../clients/exchange/ccxt-client.js";
import type { LlmCallFn } from "../macro/assess-macro-overlay.js";
import type { HttpFetchFn } from "../alerting/send-alert.js";
import type { NotificationConfig } from "../alerting/send-notification.js";
import type { NewsItem } from "../../domain/news/news-item.js";
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
import { fetchNews as defaultFetchNews } from "../macro/fetch-news.js";
import { detectMarketRegime } from "../regime/detect-market-regime.js";
import { assessParticipantPressure } from "../participants/assess-participant-pressure.js";
import { buildMarketContext } from "../participants/build-market-context.js";
import { isTradableContext } from "../participants/is-tradable-context.js";
import { analyzeStructuralSetups } from "../structure/detect-structural-setups.js";
import { analyzeConsensus } from "../consensus/evaluate-consensus.js";
import { assessMacroOverlay } from "../macro/assess-macro-overlay.js";
import { applyMacroOverlay } from "../macro/apply-macro-overlay.js";
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
import { getOpenRiskSummary, openPosition } from "../positions/track-position.js";
import { saveScanLog } from "../persistence/save-scan-log.js";
import { saveCandles } from "../persistence/save-candles.js";
import { detectDailyBias } from "../regime/detect-daily-bias.js";
import { detectOrderFlowBias } from "../analysis/compute-cvd.js";
import { buildPositionSizingSummary } from "../risk/compute-position-size.js";
import { evaluateExposureGate } from "../risk/evaluate-exposure-gate.js";

/**
 * 信号扫描工作流编排器  (PHASE_09)
 *
 * 针对单一交易品种串起 PHASE_03～08 的完整流水线。
 *
 * 执行顺序（按因果链组织）：
 *   [并行] 4h/1h/1d K 线 + 资金费率 + OI + 现货价格 + 新闻
 *   PHASE_03  detectMarketRegime        → RegimeDecision
 *   PHASE_04  assessParticipantPressure → ParticipantPressure
 *             buildMarketContext        → MarketContext
 *             isTradableContext         → 结构层前置硬门控
 *   PHASE_05  analyzeStructuralSetups   → StructuralSetup[]
 *   PHASE_06  analyzeConsensus          → TradeCandidate[]
 *   PHASE_07  assessMacroOverlay        → MacroOverlayDecision
 *             applyMacroOverlay         → 过滤后的 TradeCandidate[]
 *   PHASE_08  saveCandidate + sendAlert → 数据库落盘 + 通知推送
 *
 * 错误隔离策略：
 *   - 交易所主数据获取失败：直接抛错，流程终止；
 *   - 新闻获取失败：降级为空数组并继续；
 *   - 宏观评估失败：让候选直接通过并继续；
 *   - 通知发送失败：保留 failed 状态并记录错误。
 *
 * 去重策略：
 *   在发出告警前查询历史候选，若同一信号已成功发送，则本轮跳过；
 *   若上次是 pending 或 failed，则允许重试发送。
 */

// ── 公開型 ─────────────────────────────────────────────────────────────────

export type ScanDeps = {
  /** 交易所客户端（通常为 ccxt 封装）。 */
  client: ExchangeClient;
  /** SQLite 数据库实例，测试环境可传入 `:memory:`。 */
  db: Database.Database;
  /** LLM 调用函数，测试中通常注入 mock。 */
  llmCall: LlmCallFn;
  /** 通知发送所用的 fetch，未传入时退回全局实现。 */
  httpFetch?: HttpFetchFn;
  /** 通知通道配置。 */
  notificationConfig: NotificationConfig;
  /** NewsAPI 密钥；为空时跳过新闻抓取。 */
  newsApiKey?: string;
  /** 新闻获取函数，便于测试时替换。 */
  fetchNewsFn?: (apiKey: string, maxItems: number) => Promise<NewsItem[]>;
};

export type SignalScanResult = {
  symbol: string;
  scannedAt: number;
  /** PHASE_06 输出的候选数，即宏观过滤前数量。 */
  candidatesFound: number;
  /** PHASE_07 之后剩余的候选数，即宏观过滤后数量。 */
  candidatesAfterMacro: number;
  /** 告警发送成功数。 */
  alertsSent: number;
  /** 告警发送失败数。 */
  alertsFailed: number;
  /** 因重复而跳过的告警数。 */
  alertsSkipped: number;
  /** 宏观评估最终动作。 */
  macroAction: "pass" | "downgrade" | "block" | "error";
  skipStage?: "context_gate" | "structure" | "consensus" | "macro";
  skipReasonCode?: ReasonCode;
  regime?: string;
  participantPressureType?: string;
  dailyBias?: DailyBias;
  orderFlowBias?: OrderFlowBias;
  basisDivergence?: boolean;
  marketDriverType?: string;
  liquiditySession?: string;
  /** 非致命错误列表，供日志和报表回看。 */
  errors: string[];
};

// 进程在发送成功后、最终事务提交前异常退出时，数据库里可能暂时残留 pending。
// 这里对“最近刚创建的 pending 快照”做短时间抑制，避免重启后立刻重复发送同一条告警。
const RECENT_PENDING_SNAPSHOT_WINDOW_MS = 30 * 60 * 1000;

// ── 主函数 ──────────────────────────────────────────────────────────────────

export async function runSignalScan(
  symbol: string,
  spotSymbol: string,
  deps: ScanDeps,
  config: StrategyConfig = strategyConfig
): Promise<SignalScanResult> {
  const {
    client,
    db,
    llmCall,
    httpFetch,
    notificationConfig,
    newsApiKey = "",
    fetchNewsFn = defaultFetchNews,
  } = deps;

  const scannedAt = Date.now();
  const errors: string[] = [];

  logger.info({ symbol }, "PHASE_09: signal scan started");

  // ── [并行] 市场数据与新闻 ────────────────────────────────────────────────
  // 交易所主数据失败属于致命问题，直接中断；新闻失败仅降级，不阻塞主链路。
  const [candles4h, candles1h, candles1d, fundingRates, openInterest, spotTicker, news] =
    await Promise.all([
      fetchMarketData(client, symbol, "4h", config.marketDataLimit),
      fetchMarketData(client, symbol, "1h", config.marketDataLimit),
      fetchMarketData(client, symbol, "1d", config.dailyDataLimit).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`1d candle fetch failed: ${msg}`);
        logger.warn({ err }, "1d candle fetch failed, skipping daily bias");
        return [] as Candle[];
      }),
      fetchFundingRates(client, symbol, 10),
      fetchOpenInterest(client, symbol, 10),
      client.fetchSpotTicker(spotSymbol),
      fetchNewsFn(newsApiKey, config.maxNewsItemsForPrompt).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`news fetch failed: ${msg}`);
        logger.warn({ err }, "News fetch failed, proceeding with no news");
        return [] as NewsItem[];
      }),
    ]);

  logger.debug(
    { symbol, candles4h: candles4h.length, candles1h: candles1h.length },
    "Market data fetched"
  );

  // ── PHASE_15: K 线持久化（供离线回测使用）────────────────────────────────
  saveCandles(db, symbol, "4h", candles4h);
  saveCandles(db, symbol, "1h", candles1h);
  if (candles1d.length > 0) saveCandles(db, symbol, "1d", candles1d);

  // ── PHASE_17: 日线 Volume Profile 偏向过滤（第一性原理）────────────────────
  const dailyBiasResult =
    candles1d.length >= config.vpLookbackDays
      ? detectDailyBias(
          candles1d,
          config.vpLookbackDays,
          config.vpBucketCount,
          config.vpValueAreaPercent,
        )
      : null;
  if (dailyBiasResult) {
    logger.debug(
      {
        bias: dailyBiasResult.bias,
        priceZone: dailyBiasResult.priceZone,
        vpoc: dailyBiasResult.vpoc,
        vah: dailyBiasResult.vah,
        val: dailyBiasResult.val,
        reason: dailyBiasResult.reason,
      },
      "PHASE_17 daily VP bias"
    );
  }

  // ── PHASE_18: CVD 订单流确认（4h K 线，窗口 20 根）──────────────────────
  const orderFlowResult = detectOrderFlowBias(
    candles4h,
    config.cvdWindow,
    config.cvdNeutralThreshold
  );
  logger.debug(
    {
      bias: orderFlowResult.bias,
      cvdSlope: orderFlowResult.cvdSlope.toFixed(4),
      reason: orderFlowResult.reason,
    },
    "PHASE_18 order flow CVD"
  );

  // ── baselineAtr（最近 50 根 4h K 线的平均高低波幅）──────────────────────
  const baselineWindow = candles4h.slice(-50);
  const baselineAtr =
    baselineWindow.length > 0
      ? baselineWindow.reduce((sum, c) => sum + (c.high - c.low), 0) /
        baselineWindow.length
      : 0;

  // ── PHASE_03: 市场状态识别 ─────────────────────────────────────────────
  const regimeDecision = detectMarketRegime(candles4h, config, {
    fundingRates,
    openInterest,
    spotPrice: spotTicker.last,
  });
  logger.debug(
    {
      regime: regimeDecision.regime,
      confidence: regimeDecision.confidence,
      driverType: regimeDecision.driverType,
      driverConfidence: regimeDecision.driverConfidence,
    },
    "PHASE_03 done"
  );

  // ── PHASE_04: 参与者压力 + 市场上下文 ─────────────────────────────────
  const pressure = assessParticipantPressure(
    candles4h,
    fundingRates,
    openInterest,
    spotTicker.last,
    config
  );
  const session = getCurrentSession();
  const ctx = buildMarketContext(regimeDecision, pressure, session);
  logger.debug(
    { session, participantBias: pressure.bias, participantPressureType: pressure.pressureType },
    "PHASE_04 done"
  );

  const tradableContext = isTradableContext(ctx, config);
  if (!tradableContext.tradable) {
    logger.info(
      { symbol, reason: tradableContext.reason, reasonCode: tradableContext.reasonCode },
      "PHASE_09 context gate blocked structural scan"
    );
    const gatedResult: SignalScanResult = {
      symbol,
      scannedAt,
      candidatesFound: 0,
      candidatesAfterMacro: 0,
      alertsSent: 0,
      alertsFailed: 0,
      alertsSkipped: 0,
      macroAction: "pass",
      skipStage: "context_gate",
      skipReasonCode: tradableContext.reasonCode,
      regime: ctx.regime,
      participantPressureType: ctx.participantPressureType,
      dailyBias: dailyBiasResult?.bias,
      orderFlowBias: orderFlowResult.bias,
      basisDivergence: ctx.basisDivergence,
      marketDriverType: ctx.marketDriverType,
      liquiditySession: ctx.liquiditySession,
      errors,
    };
    saveScanLog(db, gatedResult);
    return gatedResult;
  }

  // ── PHASE_05: 结构触发检测 ─────────────────────────────────────────────
  const structuralAnalysis = analyzeStructuralSetups(candles4h, candles1h, ctx, config);
  const setups = structuralAnalysis.setups;
  logger.debug({ setupCount: setups.length }, "PHASE_05 done");

  // ── PHASE_06: 共识与风险引擎 ───────────────────────────────────────────
  // PHASE_10-B: 从数据库读取真实开仓数，使相关性暴露限制真正生效
  const openLongExposure = getOpenRiskSummary(db, "long");
  const openShortExposure = getOpenRiskSummary(db, "short");
  const portfolioExposure = getOpenRiskSummary(db);
  const consensusAnalysis = analyzeConsensus({
    symbol, setups, ctx, config, baselineAtr,
    openLongCount: openLongExposure.openCount,
    openShortCount: openShortExposure.openCount,
    openLongRiskPercent: openLongExposure.openRiskPercent,
    openShortRiskPercent: openShortExposure.openRiskPercent,
    portfolioOpenRiskPercent: portfolioExposure.openRiskPercent,
    dailyBias: dailyBiasResult?.bias,
    orderFlowBias: orderFlowResult.bias,
  });
  const candidates = consensusAnalysis.candidates;
  const candidatesFound = candidates.length;
  logger.info({ symbol, candidatesFound }, "PHASE_06 done");

  // 候选数为零时，无需继续做宏观评估和告警发送
  if (candidatesFound === 0) {
    logger.info({ symbol }, "PHASE_09: no candidates, scan complete");
    const emptyResult: SignalScanResult = {
      symbol,
      scannedAt,
      candidatesFound: 0,
      candidatesAfterMacro: 0,
      alertsSent: 0,
      alertsFailed: 0,
      alertsSkipped: 0,
      macroAction: "pass",
      skipStage: setups.length === 0 ? "structure" : "consensus",
      skipReasonCode:
        setups.length === 0
          ? structuralAnalysis.skipReasonCode
          : consensusAnalysis.skipReasonCode,
      regime: ctx.regime,
      participantPressureType: ctx.participantPressureType,
      dailyBias: dailyBiasResult?.bias,
      orderFlowBias: orderFlowResult.bias,
      basisDivergence: ctx.basisDivergence,
      marketDriverType: ctx.marketDriverType,
      liquiditySession: ctx.liquiditySession,
      errors,
    };
    saveScanLog(db, emptyResult);
    return emptyResult;
  }

  // ── PHASE_07: 宏观覆盖层 ───────────────────────────────────────────────
  let macroAction: SignalScanResult["macroAction"] = "pass";
  let macroResults: Array<{
    candidate: (typeof candidates)[number];
    decision: Awaited<ReturnType<typeof assessMacroOverlay>>["decision"] | null;
    filtered: TradeCandidate[];
  }> = [];

  try {
    macroResults = await Promise.all(
      candidates.map(async (candidate) => {
        const { decision } = await assessMacroOverlay(news, candidate, config, llmCall);
        return {
          candidate,
          decision,
          filtered: applyMacroOverlay([candidate], decision),
        };
      })
    );
    const macroDecisions = macroResults
      .map((result) => result.decision?.action)
      .filter((action): action is "pass" | "downgrade" | "block" => action !== undefined);
    macroAction = aggregateMacroAction(
      macroDecisions
    );
    logger.info(
      {
        macroAction,
        candidatesAfterMacro: macroResults.reduce(
          (count, result) => count + result.filtered.length,
          0
        ),
        macroDecisions,
      },
      "PHASE_07 done"
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`macro overlay failed: ${msg}`);
    macroAction = "error";
    macroResults = candidates.map((candidate) => ({
      candidate,
      decision: null,
      filtered: [candidate],
    }));
    // 宏观评估失败时，让所有候选直接通过并继续执行
    logger.warn({ err }, "Macro overlay failed, proceeding with all candidates");
  }

  const candidatesAfterMacro = macroResults.reduce(
    (count, result) => count + result.filtered.length,
    0
  );
  let alertsSent = 0;
  let alertsFailed = 0;
  let alertsSkipped = 0;

  for (const result of macroResults) {
    const sameDirectionExposure = getOpenRiskSummary(
      db,
      result.candidate.direction
    );
    const currentPortfolioExposure = getOpenRiskSummary(db);
    const snapshotCandidate =
      result.decision?.action === "block"
        ? applyMacroDecisionToCandidate(result.candidate, result.decision)
        : result.filtered[0] ?? result.candidate;
    const positionSizing = buildPositionSizingSummary({
      candidate: snapshotCandidate,
      config,
      sameDirectionExposureCount: sameDirectionExposure.openCount,
      sameDirectionOpenRiskPercent: sameDirectionExposure.openRiskPercent,
      portfolioOpenRiskPercent: currentPortfolioExposure.openRiskPercent,
    });

    const snapshotPayload: AlertPayload = {
      candidate: snapshotCandidate,
      marketContext: ctx,
      alertStatus: result.decision?.action === "block" ? "blocked_by_macro" : "pending",
      createdAt: scannedAt,
    };

    const snapshotCandidateId = saveCandidateSnapshot(db, snapshotPayload, {
      macroAction: result.decision?.action ?? "error",
      confirmationStatus: inferConfirmationStatus(snapshotCandidate.reasonCodes),
      dailyBias: dailyBiasResult?.bias,
      orderFlowBias: orderFlowResult.bias,
      positionSizing,
      executionOutcome:
        result.decision?.action === "block" ? "blocked_by_macro" : "pending",
      executionReasonCode:
        result.decision?.action === "block" ? "MACRO_BLOCKED" : undefined,
    });

    if (result.filtered.length === 0) {
      continue;
    }

    // ── PHASE_08: 持久化与告警发送 ───────────────────────────────────────
    const candidate = result.filtered[0];
    const executionExposureGate = evaluateExposureGate({
      sameDirectionExposureCount: sameDirectionExposure.openCount,
      sameDirectionOpenRiskPercent: sameDirectionExposure.openRiskPercent,
      portfolioOpenRiskPercent: currentPortfolioExposure.openRiskPercent,
      config,
    });
    if (!executionExposureGate.allowed) {
      updateCandidateSnapshotOutcome(db, snapshotCandidateId, "skipped_execution_gate", {
        alertStatus: "skipped_execution_gate",
        executionReasonCode: executionExposureGate.reasonCode,
      });
      alertsSkipped++;
      logger.info(
        {
          symbol: candidate.symbol,
          direction: candidate.direction,
          reasonCode: executionExposureGate.reasonCode,
        },
        "Candidate skipped at execution due to live exposure gate"
      );
      continue;
    }

    // 去重检查：同一信号若已成功发送，则本轮跳过
    const existing = findCandidate(
      db,
      candidate.symbol,
      candidate.direction,
      candidate.timeframe,
      candidate.entryHigh
    );
    const baseCandidateId = existing
      ? buildId(
          candidate.symbol,
          candidate.direction,
          candidate.timeframe,
          candidate.entryHigh
        )
      : undefined;
    const recentInFlightSnapshot = baseCandidateId
      ? (db.prepare(`
          SELECT
            delivery_started_at AS deliveryStartedAt,
            delivery_completed_at AS deliveryCompletedAt
          FROM candidate_snapshots
          WHERE base_candidate_id = ?
            AND alert_status = 'pending'
            AND delivery_started_at IS NOT NULL
            AND created_at < ?
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `).get(baseCandidateId, scannedAt) as {
          deliveryStartedAt: number | null;
          deliveryCompletedAt: number | null;
        } | undefined)
      : undefined;
    if (existing?.alertStatus === "sent") {
      updateCandidateSnapshotOutcome(db, snapshotCandidateId, "skipped_duplicate", {
        alertStatus: "skipped_duplicate",
        executionReasonCode: "already_sent",
      });
      alertsSkipped++;
      logger.debug(
        { symbol: candidate.symbol, direction: candidate.direction },
        "Duplicate alert skipped (already sent)"
      );
      continue;
    }
    if (
      existing?.alertStatus === "pending" &&
      recentInFlightSnapshot?.deliveryStartedAt &&
      recentInFlightSnapshot.deliveryCompletedAt === null &&
      scannedAt - recentInFlightSnapshot.deliveryStartedAt <= RECENT_PENDING_SNAPSHOT_WINDOW_MS
    ) {
      updateCandidateSnapshotOutcome(db, snapshotCandidateId, "skipped_duplicate", {
        alertStatus: "skipped_duplicate",
        executionReasonCode: "recent_pending_snapshot",
      });
      alertsSkipped++;
      logger.warn(
        {
          symbol: candidate.symbol,
          direction: candidate.direction,
          existingCreatedAt: existing.createdAt,
          previousDeliveryStartedAt: recentInFlightSnapshot.deliveryStartedAt,
        },
        "Recent in-flight alert attempt detected, skipping duplicate alert after restart/retry"
      );
      continue;
    }

    const payload: AlertPayload = {
      candidate,
      marketContext: ctx,
      alertStatus: "pending",
      createdAt: scannedAt,
    };

    // 永続化（INSERT OR REPLACE），先落 pending 状态，再发告警
    saveCandidate(db, payload, {
      macroAction: result.decision?.action ?? "error",
      confirmationStatus: inferConfirmationStatus(candidate.reasonCodes),
      dailyBias: dailyBiasResult?.bias,
      orderFlowBias: orderFlowResult.bias,
      positionSizing,
    });
    markCandidateDeliveryStarted(
      db,
      candidate.symbol,
      candidate.direction,
      candidate.timeframe,
      candidate.entryHigh,
      scannedAt
    );
    markCandidateSnapshotDeliveryStarted(db, snapshotCandidateId, scannedAt);

    // 发送通知告警（异步 IO，不能在事务内）
    const ok = await sendAlert(payload, notificationConfig, httpFetch, {
      positionSizing,
    });
    const finalStatus = ok ? "sent" : "failed";
    const deliveryCompletedAt = Date.now();

    // 原子化提交结果：告警状态 + 快照结果 + 仓位记录必须同时成功或同时回滚，
    // 避免进程崩溃后出现"已发告警但无仓位"或"状态仍为 pending"的不一致情形。
    db.transaction(() => {
      updateAlertStatus(
        db,
        candidate.symbol,
        candidate.direction,
        candidate.timeframe,
        candidate.entryHigh,
        finalStatus,
        { deliveryCompletedAt }
      );
      updateCandidateSnapshotOutcome(db, snapshotCandidateId, finalStatus, {
        alertStatus: finalStatus,
        deliveryCompletedAt,
      });
      if (ok) {
        // PHASE_10-B: 告警发送成功后记录仓位，并更新暴露度统计
        openPosition(db, candidate, scannedAt, {
          recommendedPositionSize: positionSizing.recommendedPositionSize,
          recommendedBaseSize: positionSizing.recommendedBaseSize,
          riskAmount: positionSizing.riskAmount,
          accountRiskPercent: positionSizing.accountRiskPercent,
        });
      }
    })();

    if (ok) {
      alertsSent++;
      logger.info(
        { symbol: candidate.symbol, direction: candidate.direction, grade: candidate.signalGrade },
        "Alert sent"
      );
    } else {
      alertsFailed++;
      errors.push(`alert failed for ${candidate.symbol} ${candidate.direction} ${candidate.timeframe}`);
      logger.warn(
        { symbol: candidate.symbol, direction: candidate.direction },
        "Alert send failed, status set to failed"
      );
    }
  }

  logger.info(
    { symbol, alertsSent, alertsFailed, alertsSkipped, macroAction },
    "PHASE_09: scan complete"
  );

  const result: SignalScanResult = {
    symbol,
    scannedAt,
    candidatesFound,
    candidatesAfterMacro,
    alertsSent,
    alertsFailed,
    alertsSkipped,
    macroAction,
    skipStage: candidatesAfterMacro === 0 && macroAction === "block" ? "macro" : undefined,
    skipReasonCode: candidatesAfterMacro === 0 && macroAction === "block" ? "MACRO_BLOCKED" : undefined,
    regime: ctx.regime,
    participantPressureType: ctx.participantPressureType,
    dailyBias: dailyBiasResult?.bias,
    orderFlowBias: orderFlowResult.bias,
    basisDivergence: ctx.basisDivergence,
    marketDriverType: ctx.marketDriverType,
    liquiditySession: ctx.liquiditySession,
    errors,
  };

  // PHASE_12: 每次扫描结果持久化到 scan_logs
  saveScanLog(db, result);

  return result;
}

function aggregateMacroAction(
  actions: Array<"pass" | "downgrade" | "block">
): SignalScanResult["macroAction"] {
  if (actions.includes("block")) return "block";
  if (actions.includes("downgrade")) return "downgrade";
  return "pass";
}

function inferConfirmationStatus(
  reasonCodes: ReasonCode[]
): "pending" | "confirmed" | "invalidated" {
  if (reasonCodes.includes("STRUCTURE_CONFIRMATION_INVALIDATED")) return "invalidated";
  if (reasonCodes.includes("STRUCTURE_CONFIRMATION_PENDING")) return "pending";
  return "confirmed";
}

function applyMacroDecisionToCandidate(
  candidate: TradeCandidate,
  decision: NonNullable<
    Awaited<ReturnType<typeof assessMacroOverlay>>["decision"]
  >
): TradeCandidate {
  return {
    ...candidate,
    macroReason: decision.reason,
    reasonCodes: [...new Set([...candidate.reasonCodes, ...decision.reasonCodes])],
  };
}

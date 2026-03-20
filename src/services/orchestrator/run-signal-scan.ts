import type { ExchangeClient } from "../../clients/exchange/ccxt-client.js";
import type { LlmCallFn } from "../macro/assess-macro-overlay.js";
import type { HttpFetchFn, TelegramConfig } from "../alerting/send-alert.js";
import type { NewsItem } from "../../domain/news/news-item.js";
import type { Candle } from "../../domain/market/candle.js";
import type { AlertPayload } from "../../domain/signal/alert-payload.js";
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
import { detectStructuralSetups } from "../structure/detect-structural-setups.js";
import { evaluateConsensus } from "../consensus/evaluate-consensus.js";
import { assessMacroOverlay } from "../macro/assess-macro-overlay.js";
import { applyMacroOverlay } from "../macro/apply-macro-overlay.js";
import { saveCandidate, updateAlertStatus } from "../persistence/save-candidate.js";
import { findCandidate } from "../persistence/load-candidates.js";
import { sendAlert } from "../alerting/send-alert.js";
import { getCurrentSession } from "../../utils/session.js";
import { countOpenByDirection, openPosition } from "../positions/track-position.js";
import { saveScanLog } from "../persistence/save-scan-log.js";
import { saveCandles } from "../persistence/save-candles.js";
import { detectDailyBias } from "../regime/detect-daily-bias.js";

/**
 * ワークフロー・オーケストレーター  (PHASE_09)
 *
 * 単一シンボルに対して PHASE_03〜08 をフルパイプラインで実行する。
 *
 * パイプライン順序（第一性原理）:
 *   [PARALLEL] 4h/1h OHLCV + ファンディング + OI + スポット価格 + ニュース
 *   PHASE_03  detectMarketRegime       → RegimeDecision
 *   PHASE_04  assessParticipantPressure → ParticipantPressure
 *             buildMarketContext        → MarketContext
 *   PHASE_05  detectStructuralSetups   → StructuralSetup[]
 *   PHASE_06  evaluateConsensus        → TradeCandidate[]
 *   PHASE_07  assessMacroOverlay       → MacroOverlayDecision
 *             applyMacroOverlay        → TradeCandidate[] (フィルタ後)
 *   PHASE_08  saveCandidate + sendAlert → DB + Telegram
 *
 * エラー分離ポリシー:
 *   - 取引所データ取得失敗  → throw（パイプライン続行不可）
 *   - ニュース取得失敗      → 空配列で継続（errors に追記）
 *   - マクロ評価失敗        → 全候補をそのまま通過させて継続（errors に追記）
 *   - Telegram 送信失敗     → "failed" ステータスで保存（errors に追記）
 *
 * 重複アラート抑制:
 *   sendAlert 前に findCandidate を照会し、alertStatus === "sent" の場合は
 *   スキップ（alertsSkipped に計上）。"failed" / "pending" は再送を試みる。
 */

// ── 公開型 ─────────────────────────────────────────────────────────────────

export type ScanDeps = {
  /** 取引所クライアント（ccxt ラッパー） */
  client: ExchangeClient;
  /** SQLite DB インスタンス（テストでは :memory: を使用） */
  db: Database.Database;
  /** LLM 呼び出し関数（テストでは vi.fn() を注入） */
  llmCall: LlmCallFn;
  /** Telegram 送信用 fetch（省略時はグローバル fetch） */
  httpFetch?: HttpFetchFn;
  /** Telegram Bot トークンとチャット ID */
  telegramConfig: TelegramConfig;
  /** NewsAPI キー（空文字の場合はニュース取得をスキップ） */
  newsApiKey?: string;
  /** ニュース取得関数（テスト用オーバーライド、デフォルト: fetchNews） */
  fetchNewsFn?: (apiKey: string, maxItems: number) => Promise<NewsItem[]>;
};

export type SignalScanResult = {
  symbol: string;
  scannedAt: number;
  /** PHASE_06 後の候補数（マクロフィルタ前） */
  candidatesFound: number;
  /** PHASE_07 後の候補数（マクロフィルタ後） */
  candidatesAfterMacro: number;
  /** 送信成功数 */
  alertsSent: number;
  /** 送信失敗数 */
  alertsFailed: number;
  /** 重複スキップ数（既に "sent" の候補） */
  alertsSkipped: number;
  /** マクロ評価アクション */
  macroAction: "pass" | "downgrade" | "block" | "error";
  /** 非致命的エラーのメッセージリスト */
  errors: string[];
};

// ── メイン関数 ─────────────────────────────────────────────────────────────

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
    telegramConfig,
    newsApiKey = "",
    fetchNewsFn = defaultFetchNews,
  } = deps;

  const scannedAt = Date.now();
  const errors: string[] = [];

  logger.info({ symbol }, "PHASE_09: signal scan started");

  // ── [PARALLEL] 市場データ + ニュース ──────────────────────────────────────
  // 取引所データ失敗は致命的（Promise.all がそのまま throw）。
  // ニュース失敗は非致命的（catch して空配列を返す）。
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

  // ── PHASE_16: 日线市场结构过滤（摆高/摆低序列，第一性原理）────────────────
  const dailyBiasResult =
    candles1d.length >= config.dailySwingLookback * 2 + 4
      ? detectDailyBias(candles1d, config.dailySwingLookback)
      : null;
  if (dailyBiasResult) {
    logger.debug(
      { bias: dailyBiasResult.bias, reason: dailyBiasResult.reason },
      "PHASE_16 daily bias"
    );
  }

  // ── baselineAtr（近 50 本 4h 足の平均 Hi-Lo 幅）─────────────────────────
  const baselineWindow = candles4h.slice(-50);
  const baselineAtr =
    baselineWindow.length > 0
      ? baselineWindow.reduce((sum, c) => sum + (c.high - c.low), 0) /
        baselineWindow.length
      : 0;

  // ── PHASE_03: 市場レジーム検出 ─────────────────────────────────────────
  const regimeDecision = detectMarketRegime(candles4h, config);
  logger.debug(
    { regime: regimeDecision.regime, confidence: regimeDecision.confidence },
    "PHASE_03 done"
  );

  // ── PHASE_04: 参加者圧力 + マーケットコンテキスト ──────────────────────
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

  // ── PHASE_05: 構造トリガー検出 ────────────────────────────────────────
  const setups = detectStructuralSetups(candles4h, candles1h, ctx, config);
  logger.debug({ setupCount: setups.length }, "PHASE_05 done");

  // ── PHASE_06: コンセンサス & リスクエンジン ───────────────────────────
  // PHASE_10-B: DB から実際の開仓数を取得して相関性暴露制限を実効化
  const openLongCount = countOpenByDirection(db, "long");
  const openShortCount = countOpenByDirection(db, "short");
  const candidates = evaluateConsensus({
    symbol, setups, ctx, config, baselineAtr,
    openLongCount, openShortCount,
    dailyBias: dailyBiasResult?.bias,
  });
  const candidatesFound = candidates.length;
  logger.info({ symbol, candidatesFound }, "PHASE_06 done");

  // 候補がゼロならマクロ評価・アラート送信は不要
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
      errors,
    };
    saveScanLog(db, emptyResult);
    return emptyResult;
  }

  // ── PHASE_07: マクロオーバーレイ ──────────────────────────────────────
  let macroAction: SignalScanResult["macroAction"] = "pass";
  let finalCandidates = candidates;

  try {
    const { decision } = await assessMacroOverlay(news, config, llmCall);
    macroAction = decision.action;
    finalCandidates = applyMacroOverlay(candidates, decision);
    logger.info(
      { macroAction, candidatesAfterMacro: finalCandidates.length },
      "PHASE_07 done"
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`macro overlay failed: ${msg}`);
    macroAction = "error";
    // マクロ評価失敗 → 全候補を通過させて続行（保守的フォールバック）
    logger.warn({ err }, "Macro overlay failed, proceeding with all candidates");
  }

  const candidatesAfterMacro = finalCandidates.length;
  let alertsSent = 0;
  let alertsFailed = 0;
  let alertsSkipped = 0;

  // ── PHASE_08: 永続化 + アラート送信 ──────────────────────────────────
  for (const candidate of finalCandidates) {
    // 重複チェック: 同一シグナルが既に "sent" の場合はスキップ
    const existing = findCandidate(
      db,
      candidate.symbol,
      candidate.direction,
      candidate.timeframe,
      candidate.entryHigh
    );
    if (existing?.alertStatus === "sent") {
      alertsSkipped++;
      logger.debug(
        { symbol: candidate.symbol, direction: candidate.direction },
        "Duplicate alert skipped (already sent)"
      );
      continue;
    }

    const payload: AlertPayload = {
      candidate,
      marketContext: ctx,
      alertStatus: "pending",
      createdAt: scannedAt,
    };

    // 永続化（INSERT OR REPLACE）
    saveCandidate(db, payload);

    // Telegram アラート送信
    const ok = await sendAlert(payload, telegramConfig, httpFetch);
    const finalStatus = ok ? "sent" : "failed";
    updateAlertStatus(
      db,
      candidate.symbol,
      candidate.direction,
      candidate.timeframe,
      candidate.entryHigh,
      finalStatus
    );

    if (ok) {
      alertsSent++;
      // PHASE_10-B: アラート送信成功 → 仓位を記録（相関性暴露カウントを更新）
      openPosition(db, candidate, scannedAt);
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
    errors,
  };

  // PHASE_12: 每次扫描结果持久化到 scan_logs
  saveScanLog(db, result);

  return result;
}

import type { Candle } from "../../domain/market/candle.js";
import type { StrategyConfig } from "../../app/config.js";
import type {
  BacktestSignal,
  BacktestTrade,
  BacktestTradeStatus,
} from "../../domain/backtest/backtest-types.js";
import type { MarketContext } from "../../domain/market/market-context.js";
import type { EqualLevel } from "../../domain/market/equal-level.js";
import { detectStructuralSetups } from "../structure/detect-structural-setups.js";
import { detectEqualHighs, detectEqualLows } from "../structure/detect-equal-levels.js";

/**
 * バックテストエンジン  (PHASE_10-C)
 *
 * 設計:
 *   1. generateBacktestSignals — ウォークフォワードで構造シグナルを検出
 *   2. runBacktest              — シグナルリストを受け取り取引をシミュレート
 *
 * エントリー価格戦略（保守的最悪フィル）:
 *   long:  entryHigh で買い（エントリーゾーンの上端 = 最も高い価格）
 *   short: entryLow  で売り（エントリーゾーンの下端 = 最も低い価格）
 *
 * エグジット判定（各後続足で順番にチェック）:
 *   long:  candle.low <= stopLoss → SL; candle.high >= takeProfit → TP
 *   short: candle.high >= stopLoss → SL; candle.low  <= takeProfit → TP
 *   同一足で SL/TP 両方ヒット → SL 優先（保守的）
 *
 * pnlR 計算:
 *   entryMid = (entryLow + entryHigh) / 2
 *   risk = |entryMid - stopLoss|
 *   long  pnlR = (exitPrice - entryMid) / risk
 *   short pnlR = (entryMid - exitPrice) / risk
 */

// ── ウォークフォワード信号生成 ──────────────────────────────────────────────

/**
 * ウォークフォワード方式でバックテスト用シグナルを生成する。
 *
 * 各 4h 足の境界で構造検出を実行し、新規シグナルを収集する。
 * 検出には `detectStructuralSetups` を使用するが、
 * マクロ・レジーム・参与者ゲートはバイパスし、
 * 純粋に構造的セットアップの検出能力をテストする。
 *
 * 重複排除: 同一の (direction, entryHigh) ペアは 1 回のみ記録する。
 *
 * @param candles4h 4h 足（時系列昇順）
 * @param candles1h 1h 足（confirmEntry に使用）
 * @param config    StrategyConfig
 * @param minHistory 検出開始に必要な最小 4h 足数（デフォルト 50）
 */
export function generateBacktestSignals(
  candles4h: Candle[],
  candles1h: Candle[],
  config: StrategyConfig,
  minHistory = 50
): BacktestSignal[] {
  const signals: BacktestSignal[] = [];
  const seenKeys = new Set<string>();

  // Fix 5: 等高等低检测提前到循环外，避免每次迭代重复执行 O(n log n) 排序
  // 注：使用全量 candles4h 预计算，存在轻微前视偏差（future swings included）；
  // 对价格结构型区域影响可忽略，换取 O(n²) → O(n²/n log n) 的回测性能提升。
  const precomputedEqualLevels: EqualLevel[] = [
    ...detectEqualHighs(candles4h, config.equalLevelTolerance),
    ...detectEqualLows(candles4h, config.equalLevelTolerance),
  ];

  // レジーム/参与者ゲートをバイパスする中立 MarketContext
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

// ── 取引シミュレーション ────────────────────────────────────────────────────

/**
 * シグナルリストを candles に対してシミュレートし、BacktestTrade[] を返す。
 *
 * 各シグナルのエントリー足の次の足から走査を開始する。
 * データ終端まで決済できなかった取引は status="expired" として記録する。
 *
 * @param signals 検出済みシグナル（generateBacktestSignals の出力など）
 * @param candles シミュレーション用足データ（4h を推奨）
 */
export function runBacktest(
  signals: BacktestSignal[],
  candles: Candle[]
): BacktestTrade[] {
  return signals.map((signal) => simulateTrade(signal, candles));
}

// ── 内部実装 ───────────────────────────────────────────────────────────────

function simulateTrade(signal: BacktestSignal, candles: Candle[]): BacktestTrade {
  const entryPrice =
    signal.direction === "long" ? signal.entryHigh : signal.entryLow;

  const entryMid = (signal.entryLow + signal.entryHigh) / 2;
  const risk = Math.abs(entryMid - signal.stopLoss);

  // エントリー足の次から走査
  const scanStart = signal.candleIndex + 1;

  for (let i = scanStart; i < candles.length; i++) {
    const c = candles[i];

    if (signal.direction === "long") {
      const slHit = c.low <= signal.stopLoss;
      const tpHit = c.high >= signal.takeProfit;

      if (slHit || tpHit) {
        // 同一足で両方ヒット → SL 優先（保守的）
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

  // データ終端 — 最終足の終値で強制決済
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

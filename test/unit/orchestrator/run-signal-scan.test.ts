import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initDb } from "../../../src/services/persistence/init-db.js";
import { initPositionsDb } from "../../../src/services/positions/init-positions-db.js";
import {
  saveCandidate,
  saveCandidateSnapshot,
  markCandidateDeliveryStarted,
  markCandidateSnapshotDeliveryStarted,
  updateAlertStatus,
} from "../../../src/services/persistence/save-candidate.js";
import { runSignalScan } from "../../../src/services/orchestrator/run-signal-scan.js";
import type { ScanDeps } from "../../../src/services/orchestrator/run-signal-scan.js";
import { strategyConfig } from "../../../src/app/config.js";
import type { ExchangeClient } from "../../../src/clients/exchange/ccxt-client.js";
import type { TradeCandidate } from "../../../src/domain/signal/trade-candidate.js";
import type { MarketContext } from "../../../src/domain/market/market-context.js";
import type { AlertPayload } from "../../../src/domain/signal/alert-payload.js";
import type { RegimeDecision } from "../../../src/domain/regime/regime-decision.js";
import type { ParticipantPressure } from "../../../src/domain/participants/participant-pressure.js";
import type { StructuralSetup } from "../../../src/domain/signal/structural-setup.js";
import type { MacroAssessment, MacroOverlayDecision } from "../../../src/domain/macro/macro-assessment.js";

// ── フェーズサービスをモック ───────────────────────────────────────────────
// オーケストレーターのテストは「各フェーズを正しい順序で正しい引数で呼ぶか」と
// 「エラー処理・重複排除の協調ロジック」に集中する。各フェーズの内部ロジックは
// それぞれの専用ユニットテストで検証済み。

vi.mock("../../../src/services/regime/detect-market-regime.js");
vi.mock("../../../src/services/participants/assess-participant-pressure.js");
vi.mock("../../../src/services/participants/build-market-context.js");
vi.mock("../../../src/services/participants/is-tradable-context.js");
vi.mock("../../../src/services/structure/detect-structural-setups.js");
vi.mock("../../../src/services/consensus/evaluate-consensus.js");
vi.mock("../../../src/services/macro/assess-macro-overlay.js");
vi.mock("../../../src/services/macro/apply-macro-overlay.js");
vi.mock("../../../src/utils/session.js");

import { detectMarketRegime } from "../../../src/services/regime/detect-market-regime.js";
import { assessParticipantPressure } from "../../../src/services/participants/assess-participant-pressure.js";
import { buildMarketContext } from "../../../src/services/participants/build-market-context.js";
import { isTradableContext } from "../../../src/services/participants/is-tradable-context.js";
import { analyzeStructuralSetups } from "../../../src/services/structure/detect-structural-setups.js";
import { analyzeConsensus } from "../../../src/services/consensus/evaluate-consensus.js";
import { assessMacroOverlay } from "../../../src/services/macro/assess-macro-overlay.js";
import { applyMacroOverlay } from "../../../src/services/macro/apply-macro-overlay.js";
import { getCurrentSession } from "../../../src/utils/session.js";

// ── テスト夾具 ────────────────────────────────────────────────────────────

const SYMBOL = "BTCUSDT";
const SPOT_SYMBOL = "BTC/USDT";

const mockCandle = {
  timestamp: Date.now(),
  open: 60000,
  high: 60500,
  low: 59500,
  close: 60200,
  volume: 1000,
};
const mockCandles = Array.from({ length: 20 }, (_, i) => ({
  ...mockCandle,
  timestamp: mockCandle.timestamp + i * 14400000,
}));

const mockRegimeDecision: RegimeDecision = {
  regime: "trend",
  confidence: 75,
  driverType: "new-longs",
  driverConfidence: 82,
  driverReasons: ["价格上涨且 OI 上升，说明上涨主要由新多头推动"],
  reasons: [],
  reasonCodes: [],
};

const mockPressure: ParticipantPressure = {
  bias: "balanced",
  pressureType: "none",
  confidence: 70,
  rationale: "",
  spotPerpBasis: 0,
  basisDivergence: false,
  reasonCodes: [],
};

const mockCtx: MarketContext = {
  regime: "trend",
  regimeConfidence: 75,
  regimeReasons: [],
  marketDriverType: "new-longs",
  marketDriverConfidence: 82,
  participantBias: "balanced",
  participantPressureType: "none",
  participantConfidence: 70,
  participantRationale: "",
  spotPerpBasis: 0,
  basisDivergence: false,
  liquiditySession: "london_ny_overlap",
  summary: "trend / balanced / london_ny_overlap",
  reasonCodes: [],
};

const mockCandidate: TradeCandidate = {
  symbol: SYMBOL,
  direction: "long",
  timeframe: "4h",
  entryLow: 59800,
  entryHigh: 60000,
  stopLoss: 58800,
  takeProfit: 63000,
  riskReward: 2.5,
  signalGrade: "high-conviction",
  regimeAligned: true,
  participantAligned: true,
  structureReason: "看涨FVG",
  contextReason: "trend market",
  reasonCodes: [],
};

const mockSetup: StructuralSetup = {
  timeframe: "4h",
  direction: "long",
  entryLow: 59800,
  entryHigh: 60000,
  stopLossHint: 58800,
  takeProfitHint: 63000,
  structureScore: 70,
  structureReason: "看涨FVG",
  invalidationReason: "1h close below 58800",
  confluenceFactors: ["fvg", "liquidity-sweep"],
  confirmationStatus: "confirmed",
  confirmationTimeframe: "1h",
  reasonCodes: [],
};

const mockPassDecision: MacroOverlayDecision = {
  action: "pass",
  confidence: 8,
  reason: "Bullish macro",
  reasonCodes: [],
};

const mockBlockDecision: MacroOverlayDecision = {
  action: "block",
  confidence: 9,
  reason: "Bearish macro with risk flags",
  reasonCodes: ["EVENT_WINDOW_WATCH_ONLY", "MACRO_BLOCKED"],
};

const mockDowngradeDecision: MacroOverlayDecision = {
  action: "downgrade",
  confidence: 8,
  reason: "Bearish macro, no risk flags",
  reasonCodes: ["MACRO_DOWNGRADED"],
};

const mockAssessment: MacroAssessment = {
  macroBias: "bullish",
  confidenceScore: 8,
  btcRelevance: 8,
  catalystSummary: "Bullish macro",
  riskFlags: [],
  rawPrompt: "",
  rawResponse: "",
};

function makeClient(overrides: Partial<ExchangeClient> = {}): ExchangeClient {
  return {
    fetchOHLCV: vi.fn().mockResolvedValue(mockCandles),
    fetchFundingRates: vi.fn().mockResolvedValue([]),
    fetchOpenInterest: vi.fn().mockResolvedValue([]),
    fetchTicker: vi.fn().mockResolvedValue({ last: 60000 }),
    fetchSpotTicker: vi.fn().mockResolvedValue({ last: 60000 }),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ScanDeps> = {}): ScanDeps & { db: Database.Database } {
  const freshDb = new Database(":memory:");
  initDb(freshDb);
  initPositionsDb(freshDb);
  const resolvedDb = (overrides.db ?? freshDb) as Database.Database;
  const base = {
    client: makeClient(),
    llmCall: vi.fn().mockResolvedValue("{}") as ScanDeps["llmCall"],
    httpFetch: vi.fn().mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch,
    notificationConfig: { telegram: { botToken: "test-token", chatId: "-100123456" } },
    newsApiKey: "",
    fetchNewsFn: vi.fn().mockResolvedValue([]) as ScanDeps["fetchNewsFn"],
  };
  return { ...base, ...overrides, db: resolvedDb };
}

// ── beforeEach: フェーズモックのデフォルト戻り値 ─────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(detectMarketRegime).mockReturnValue(mockRegimeDecision);
  vi.mocked(assessParticipantPressure).mockReturnValue(mockPressure);
  vi.mocked(buildMarketContext).mockReturnValue(mockCtx);
  vi.mocked(isTradableContext).mockReturnValue({
    tradable: true,
    reason: "Context is tradable; proceed to structure detection.",
  });
  vi.mocked(analyzeStructuralSetups).mockReturnValue({
    setups: [mockSetup],
  });
  vi.mocked(analyzeConsensus).mockReturnValue({
    candidates: [],
    skipReasonCode: "RISK_REWARD_TOO_LOW",
  });
  vi.mocked(assessMacroOverlay).mockResolvedValue({
    assessment: mockAssessment,
    decision: mockPassDecision,
  });
  vi.mocked(applyMacroOverlay).mockImplementation((candidates) => candidates);
  vi.mocked(getCurrentSession).mockReturnValue("london_ny_overlap");
});

// ── フェーズ呼び出し順序 ─────────────────────────────────────────────────

describe("runSignalScan — フェーズ呼び出し順序", () => {
  it("PHASE_03: detectMarketRegime が呼ばれる", async () => {
    const deps = makeDeps();
    await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    expect(detectMarketRegime).toHaveBeenCalledWith(
      mockCandles,
      expect.any(Object),
      expect.objectContaining({
        fundingRates: [],
        openInterest: [],
        spotPrice: 60000,
      })
    );
  });

  it("PHASE_04: assessParticipantPressure が呼ばれる", async () => {
    const deps = makeDeps();
    await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    expect(assessParticipantPressure).toHaveBeenCalledOnce();
  });

  it("PHASE_04: buildMarketContext が呼ばれる", async () => {
    const deps = makeDeps();
    await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    expect(buildMarketContext).toHaveBeenCalledOnce();
  });

  it("PHASE_05: analyzeStructuralSetups が呼ばれる", async () => {
    const deps = makeDeps();
    await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    expect(analyzeStructuralSetups).toHaveBeenCalledOnce();
  });

  it("PHASE_31: isTradableContext が呼ばれる", async () => {
    const deps = makeDeps();
    await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    expect(isTradableContext).toHaveBeenCalledWith(mockCtx, expect.any(Object));
  });

  it("PHASE_06: analyzeConsensus が正しい symbol で呼ばれる", async () => {
    const deps = makeDeps();
    await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    expect(analyzeConsensus).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: SYMBOL })
    );
  });

  it("候補がゼロの場合 assessMacroOverlay は呼ばれない", async () => {
    vi.mocked(analyzeConsensus).mockReturnValue({
      candidates: [],
      skipReasonCode: "RISK_REWARD_TOO_LOW",
    });
    const deps = makeDeps();
    await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    expect(assessMacroOverlay).not.toHaveBeenCalled();
  });

  it("候補が存在する場合 PHASE_07: assessMacroOverlay が呼ばれる", async () => {
    vi.mocked(analyzeConsensus).mockReturnValue({
      candidates: [mockCandidate],
    });
    vi.mocked(applyMacroOverlay).mockReturnValue([mockCandidate]);
    const deps = makeDeps();
    await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    expect(assessMacroOverlay).toHaveBeenCalledWith(
      [],
      mockCandidate,
      expect.any(Object),
      deps.llmCall
    );
  });
});

describe("runSignalScan — 前置门控", () => {
  it("context 不可交易时不会继续执行结构层", async () => {
    vi.mocked(isTradableContext).mockReturnValue({
      tradable: false,
      reason: "skip",
      reasonCode: "DELEVERAGING_VACUUM",
    });
    const deps = makeDeps();
    const result = await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    expect(analyzeStructuralSetups).not.toHaveBeenCalled();
    expect(analyzeConsensus).not.toHaveBeenCalled();
    expect(result.candidatesFound).toBe(0);
    expect(result.skipStage).toBe("context_gate");
  });
});

// ── 候補なし（早期リターン）───────────────────────────────────────────────

describe("runSignalScan — 候補ゼロ", () => {
  it("candidatesFound=0 → early return", async () => {
    vi.mocked(analyzeConsensus).mockReturnValue({
      candidates: [],
      skipReasonCode: "CORRELATED_EXPOSURE_LIMIT",
    });
    const deps = makeDeps();
    const result = await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    expect(result.candidatesFound).toBe(0);
    expect(result.candidatesAfterMacro).toBe(0);
    expect(result.alertsSent).toBe(0);
    expect(result.macroAction).toBe("pass");
    expect(result.skipStage).toBe("consensus");
    expect(result.skipReasonCode).toBe("CORRELATED_EXPOSURE_LIMIT");
  });

  it("structure 层无产出时会保留真实 structural skipReasonCode", async () => {
    vi.mocked(analyzeStructuralSetups).mockReturnValue({
      setups: [],
      skipReasonCode: "STRUCTURE_CONFIRMATION_INVALIDATED",
    });
    vi.mocked(analyzeConsensus).mockReturnValue({
      candidates: [],
    });

    const deps = makeDeps();
    const result = await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);

    expect(result.skipStage).toBe("structure");
    expect(result.skipReasonCode).toBe("STRUCTURE_CONFIRMATION_INVALIDATED");
  });

  it("consensus 层无产出时会保留真实 consensus skipReasonCode", async () => {
    vi.mocked(analyzeStructuralSetups).mockReturnValue({
      setups: [mockSetup],
    });
    vi.mocked(analyzeConsensus).mockReturnValue({
      candidates: [],
      skipReasonCode: "STOP_DISTANCE_TOO_WIDE",
    });

    const deps = makeDeps();
    const result = await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);

    expect(result.skipStage).toBe("consensus");
    expect(result.skipReasonCode).toBe("STOP_DISTANCE_TOO_WIDE");
  });

  it("候補なし → httpFetch（Telegram）を呼ばない", async () => {
    vi.mocked(analyzeConsensus).mockReturnValue({
      candidates: [],
      skipReasonCode: "RISK_REWARD_TOO_LOW",
    });
    const httpFetch = vi.fn() as unknown as typeof fetch;
    const deps = makeDeps({ httpFetch });
    await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    expect(httpFetch).not.toHaveBeenCalled();
  });
});

// ── ハッピーパス ─────────────────────────────────────────────────────────

describe("runSignalScan — ハッピーパス", () => {
  beforeEach(() => {
    vi.mocked(analyzeConsensus).mockReturnValue({
      candidates: [mockCandidate],
    });
    vi.mocked(applyMacroOverlay).mockReturnValue([mockCandidate]);
  });

  it("candidatesFound=1, alertsSent=1", async () => {
    const deps = makeDeps();
    const result = await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    expect(result.candidatesFound).toBe(1);
    expect(result.alertsSent).toBe(1);
    expect(result.alertsFailed).toBe(0);
    expect(result.alertsSkipped).toBe(0);
  });

  it("macroAction が pass", async () => {
    vi.mocked(assessMacroOverlay).mockResolvedValue({
      assessment: mockAssessment,
      decision: mockPassDecision,
    });
    const deps = makeDeps();
    const result = await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    expect(result.macroAction).toBe("pass");
  });

  it("アラート送信後 DB に 'sent' で保存される", async () => {
    const deps = makeDeps();
    await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    const { findCandidate: find } = await import(
      "../../../src/services/persistence/load-candidates.js"
    );
    const saved = find(deps.db, SYMBOL, "long", "4h", 60000);
    expect(saved?.alertStatus).toBe("sent");
  });

  it("送信成功した snapshot も最終結果として sent を記録する", async () => {
    const deps = makeDeps();
    await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    const row = deps.db.prepare(`
      SELECT alert_status, execution_outcome
      FROM candidate_snapshots
      ORDER BY id DESC
      LIMIT 1
    `).get() as { alert_status: string; execution_outcome: string };
    expect(row.alert_status).toBe("sent");
    expect(row.execution_outcome).toBe("sent");
  });

  it("result に symbol が含まれる", async () => {
    const deps = makeDeps();
    const result = await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    expect(result.symbol).toBe(SYMBOL);
  });

  it("result.scannedAt は Date.now() に近い", async () => {
    const before = Date.now();
    const deps = makeDeps();
    const result = await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    const after = Date.now();
    expect(result.scannedAt).toBeGreaterThanOrEqual(before);
    expect(result.scannedAt).toBeLessThanOrEqual(after);
  });

  it("accountSizeUsd 配置后会把仓位建议写入 candidates", async () => {
    const deps = makeDeps();
    await runSignalScan(
      SYMBOL,
      SPOT_SYMBOL,
      deps,
      { ...strategyConfig, accountSizeUsd: 100_000 }
    );
    const row = deps.db.prepare(`
      SELECT recommended_position_size, risk_amount, account_risk_percent
      FROM candidates
      LIMIT 1
    `).get() as {
      recommended_position_size: number;
      risk_amount: number;
      account_risk_percent: number;
    };
    expect(row.recommended_position_size).toBeGreaterThan(0);
    expect(row.risk_amount).toBe(1_000);
    expect(row.account_risk_percent).toBeCloseTo(0.01, 5);
  });
});

// ── マクロブロック ───────────────────────────────────────────────────────

describe("runSignalScan — マクロブロック", () => {
  it("block → candidatesAfterMacro=0, alertsSent=0", async () => {
    vi.mocked(analyzeConsensus).mockReturnValue({
      candidates: [mockCandidate],
    });
    vi.mocked(assessMacroOverlay).mockResolvedValue({
      assessment: mockAssessment,
      decision: mockBlockDecision,
    });
    vi.mocked(applyMacroOverlay).mockReturnValue([]); // block → 空配列
    const deps = makeDeps();
    const result = await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    expect(result.candidatesFound).toBe(1);
    expect(result.candidatesAfterMacro).toBe(0);
    expect(result.alertsSent).toBe(0);
    expect(result.macroAction).toBe("block");
    expect(result.skipStage).toBe("macro");
  });

  it("block → httpFetch を呼ばない", async () => {
    vi.mocked(analyzeConsensus).mockReturnValue({
      candidates: [mockCandidate],
    });
    vi.mocked(assessMacroOverlay).mockResolvedValue({
      assessment: mockAssessment,
      decision: mockBlockDecision,
    });
    vi.mocked(applyMacroOverlay).mockReturnValue([]);
    const httpFetch = vi.fn() as unknown as typeof fetch;
    const deps = makeDeps({ httpFetch });
    await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    expect(httpFetch).not.toHaveBeenCalled();
  });

  it("block 样本会写入 candidate_snapshots", async () => {
    vi.mocked(analyzeConsensus).mockReturnValue({
      candidates: [mockCandidate],
    });
    vi.mocked(assessMacroOverlay).mockResolvedValue({
      assessment: mockAssessment,
      decision: mockBlockDecision,
    });
    vi.mocked(applyMacroOverlay).mockReturnValue([]);
    const deps = makeDeps();
    await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    const row = deps.db.prepare(`
      SELECT alert_status, macro_action, execution_outcome, execution_reason_code
      FROM candidate_snapshots
      ORDER BY id DESC
      LIMIT 1
    `).get() as {
      alert_status: string;
      macro_action: string;
      execution_outcome: string;
      execution_reason_code: string;
    };
    expect(row.alert_status).toBe("blocked_by_macro");
    expect(row.macro_action).toBe("block");
    expect(row.execution_outcome).toBe("blocked_by_macro");
    expect(row.execution_reason_code).toBe("MACRO_BLOCKED");
  });
});

// ── マクロダウングレード ─────────────────────────────────────────────────

describe("runSignalScan — マクロダウングレード", () => {
  it("downgrade → macroAction='downgrade', alertsSent=1", async () => {
    const downgradedCandidate: TradeCandidate = {
      ...mockCandidate,
      signalGrade: "standard",
      reasonCodes: ["MACRO_DOWNGRADED"],
    };
    vi.mocked(analyzeConsensus).mockReturnValue({
      candidates: [mockCandidate],
    });
    vi.mocked(assessMacroOverlay).mockResolvedValue({
      assessment: mockAssessment,
      decision: mockDowngradeDecision,
    });
    vi.mocked(applyMacroOverlay).mockReturnValue([downgradedCandidate]);
    const deps = makeDeps();
    const result = await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    expect(result.macroAction).toBe("downgrade");
    expect(result.alertsSent).toBe(1);
  });
});

// ── 重複アラート抑制 ─────────────────────────────────────────────────────

describe("runSignalScan — 重複アラート抑制", () => {
  it('alertStatus="sent" の候補は スキップ → alertsSkipped=1', async () => {
    vi.mocked(analyzeConsensus).mockReturnValue({
      candidates: [mockCandidate],
    });
    vi.mocked(applyMacroOverlay).mockReturnValue([mockCandidate]);

    const deps = makeDeps();

    // 事前に "sent" で DB に保存
    const sentPayload: AlertPayload = {
      candidate: mockCandidate,
      marketContext: mockCtx,
      alertStatus: "sent",
      createdAt: Date.now() - 1000,
    };
    saveCandidate(deps.db, sentPayload);

    const result = await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    expect(result.alertsSkipped).toBe(1);
    expect(result.alertsSent).toBe(0);
    expect(deps.httpFetch).not.toHaveBeenCalled();
    const row = deps.db.prepare(`
      SELECT alert_status, execution_outcome, execution_reason_code
      FROM candidate_snapshots
      ORDER BY id DESC
      LIMIT 1
    `).get() as {
      alert_status: string;
      execution_outcome: string;
      execution_reason_code: string;
    };
    expect(row.alert_status).toBe("skipped_duplicate");
    expect(row.execution_outcome).toBe("skipped_duplicate");
    expect(row.execution_reason_code).toBe("already_sent");
  });

  it('alertStatus="failed" の候補は 再送を試みる → alertsSent=1', async () => {
    vi.mocked(analyzeConsensus).mockReturnValue({
      candidates: [mockCandidate],
    });
    vi.mocked(applyMacroOverlay).mockReturnValue([mockCandidate]);

    const deps = makeDeps();

    // 事前に "failed" で DB に保存
    const failedPayload: AlertPayload = {
      candidate: mockCandidate,
      marketContext: mockCtx,
      alertStatus: "failed",
      createdAt: Date.now() - 5000,
    };
    saveCandidate(deps.db, failedPayload);

    const result = await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    expect(result.alertsSent).toBe(1);
    expect(result.alertsSkipped).toBe(0);
  });

  it('alertStatus="pending" の候補は 再送を試みる → alertsSent=1', async () => {
    vi.mocked(analyzeConsensus).mockReturnValue({
      candidates: [mockCandidate],
    });
    vi.mocked(applyMacroOverlay).mockReturnValue([mockCandidate]);

    const deps = makeDeps();

    const pendingPayload: AlertPayload = {
      candidate: mockCandidate,
      marketContext: mockCtx,
      alertStatus: "pending",
      createdAt: Date.now() - 2000,
    };
    saveCandidate(deps.db, pendingPayload);

    const result = await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    expect(result.alertsSent).toBe(1);
    expect(result.alertsSkipped).toBe(0);
  });

  it("最近的 pending snapshot 会触发重启保护，避免立即重复发送", async () => {
    vi.mocked(analyzeConsensus).mockReturnValue({
      candidates: [mockCandidate],
    });
    vi.mocked(applyMacroOverlay).mockReturnValue([mockCandidate]);

    const deps = makeDeps();
    const createdAt = Date.now() - 5_000;
    const pendingPayload: AlertPayload = {
      candidate: mockCandidate,
      marketContext: mockCtx,
      alertStatus: "pending",
      createdAt,
    };
    saveCandidate(deps.db, pendingPayload);
    const snapshotId = saveCandidateSnapshot(deps.db, pendingPayload, {
      executionOutcome: "pending",
    });
    markCandidateDeliveryStarted(deps.db, "BTCUSDT", "long", "4h", 60000, createdAt);
    markCandidateSnapshotDeliveryStarted(deps.db, snapshotId, createdAt);

    const result = await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    expect(result.alertsSent).toBe(0);
    expect(result.alertsSkipped).toBe(1);
    expect(deps.httpFetch).not.toHaveBeenCalled();

    const row = deps.db.prepare(`
      SELECT alert_status, execution_outcome, execution_reason_code
      FROM candidate_snapshots
      ORDER BY id DESC
      LIMIT 1
    `).get() as {
      alert_status: string;
      execution_outcome: string;
      execution_reason_code: string;
    };
    expect(row.alert_status).toBe("skipped_duplicate");
    expect(row.execution_outcome).toBe("skipped_duplicate");
    expect(row.execution_reason_code).toBe("recent_pending_snapshot");
  });

  it("只有 in-flight pending snapshot 才会触发重启保护，普通 pending 会继续重试", async () => {
    vi.mocked(analyzeConsensus).mockReturnValue({
      candidates: [mockCandidate],
    });
    vi.mocked(applyMacroOverlay).mockReturnValue([mockCandidate]);

    const deps = makeDeps();
    const pendingPayload: AlertPayload = {
      candidate: mockCandidate,
      marketContext: mockCtx,
      alertStatus: "pending",
      createdAt: Date.now() - 5_000,
    };
    saveCandidate(deps.db, pendingPayload);
    saveCandidateSnapshot(deps.db, pendingPayload, {
      executionOutcome: "pending",
    });

    const result = await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    expect(result.alertsSent).toBe(1);
    expect(result.alertsSkipped).toBe(0);
    expect(deps.httpFetch).toHaveBeenCalledTimes(1);
  });

  it("複数候補: 1つ済み + 1つ新規 → skipped=1, sent=1", async () => {
    const newCandidate: TradeCandidate = {
      ...mockCandidate,
      symbol: "ETHUSDT",
      entryHigh: 3000,
      entryLow: 2980,
    };
    vi.mocked(analyzeConsensus).mockReturnValue({
      candidates: [mockCandidate, newCandidate],
    });

    const deps = makeDeps();

    // BTCUSDT は既に sent
    const sentPayload: AlertPayload = {
      candidate: mockCandidate,
      marketContext: mockCtx,
      alertStatus: "sent",
      createdAt: Date.now() - 1000,
    };
    saveCandidate(deps.db, sentPayload);

    const result = await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    expect(result.alertsSkipped).toBe(1);
    expect(result.alertsSent).toBe(1);
  });
});

// ── アラート送信失敗 ─────────────────────────────────────────────────────

describe("runSignalScan — アラート送信失敗", () => {
  it("httpFetch が ok:false → alertsFailed=1, errors に追記", async () => {
    vi.mocked(analyzeConsensus).mockReturnValue({
      candidates: [mockCandidate],
    });
    vi.mocked(applyMacroOverlay).mockReturnValue([mockCandidate]);

    const httpFetch = vi.fn().mockResolvedValue({ ok: false, status: 429 }) as unknown as typeof fetch;
    const deps = makeDeps({ httpFetch });
    const result = await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    expect(result.alertsFailed).toBe(1);
    expect(result.alertsSent).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("送信失敗後 DB に 'failed' で保存される", async () => {
    vi.mocked(analyzeConsensus).mockReturnValue({
      candidates: [mockCandidate],
    });
    vi.mocked(applyMacroOverlay).mockReturnValue([mockCandidate]);

    const httpFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
    const deps = makeDeps({ httpFetch });
    await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);

    const { findCandidate: find } = await import(
      "../../../src/services/persistence/load-candidates.js"
    );
    const saved = find(deps.db, SYMBOL, "long", "4h", 60000);
    expect(saved?.alertStatus).toBe("failed");
    const row = deps.db.prepare(`
      SELECT alert_status, execution_outcome
      FROM candidate_snapshots
      ORDER BY id DESC
      LIMIT 1
    `).get() as { alert_status: string; execution_outcome: string };
    expect(row.alert_status).toBe("failed");
    expect(row.execution_outcome).toBe("failed");
  });
});

// ── ニュース取得失敗 ─────────────────────────────────────────────────────

describe("runSignalScan — ニュース取得失敗", () => {
  it("fetchNewsFn throw → errors に追記して継続", async () => {
    vi.mocked(analyzeConsensus).mockReturnValue({
      candidates: [],
      skipReasonCode: "RISK_REWARD_TOO_LOW",
    });
    const deps = makeDeps({
      fetchNewsFn: vi.fn().mockRejectedValue(new Error("NewsAPI unavailable")),
    });
    const result = await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    expect(result.errors.some(e => e.includes("news fetch failed"))).toBe(true);
  });

  it("ニュース失敗後もスキャン完了 → candidatesFound=0", async () => {
    vi.mocked(analyzeConsensus).mockReturnValue({
      candidates: [],
      skipReasonCode: "RISK_REWARD_TOO_LOW",
    });
    const deps = makeDeps({
      fetchNewsFn: vi.fn().mockRejectedValue(new Error("NewsAPI unavailable")),
    });
    const result = await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    expect(result.candidatesFound).toBe(0);
    expect(result.symbol).toBe(SYMBOL);
  });

  it("ニュース失敗でも候補がある場合はアラートを送る", async () => {
    vi.mocked(analyzeConsensus).mockReturnValue({
      candidates: [mockCandidate],
    });
    vi.mocked(applyMacroOverlay).mockReturnValue([mockCandidate]);
    const deps = makeDeps({
      fetchNewsFn: vi.fn().mockRejectedValue(new Error("NewsAPI timeout")),
    });
    const result = await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    expect(result.alertsSent).toBe(1);
  });
});

// ── マクロ評価失敗 ───────────────────────────────────────────────────────

describe("runSignalScan — マクロ評価失敗", () => {
  it("assessMacroOverlay throw → macroAction='error', 全候補を通過", async () => {
    vi.mocked(analyzeConsensus).mockReturnValue({
      candidates: [mockCandidate],
    });
    vi.mocked(assessMacroOverlay).mockRejectedValue(new Error("LLM timeout"));
    // applyMacroOverlay が呼ばれない場合 candidates がそのまま使われる
    const deps = makeDeps();
    const result = await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    expect(result.macroAction).toBe("error");
    expect(result.errors.some(e => e.includes("macro overlay failed"))).toBe(true);
  });

  it("マクロエラー時も候補はアラート送信される", async () => {
    vi.mocked(analyzeConsensus).mockReturnValue({
      candidates: [mockCandidate],
    });
    vi.mocked(assessMacroOverlay).mockRejectedValue(new Error("LLM timeout"));
    const deps = makeDeps();
    const result = await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    expect(result.alertsSent).toBe(1);
  });

  it("マクロエラー時 candidatesAfterMacro = candidatesFound（フォールバック）", async () => {
    vi.mocked(analyzeConsensus).mockReturnValue({
      candidates: [mockCandidate],
    });
    vi.mocked(assessMacroOverlay).mockRejectedValue(new Error("LLM timeout"));
    const deps = makeDeps();
    const result = await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    expect(result.candidatesAfterMacro).toBe(result.candidatesFound);
  });
});

// ── 取引所データ取得失敗 ─────────────────────────────────────────────────

describe("runSignalScan — 取引所データ取得失敗", () => {
  it("fetchOHLCV throw → runSignalScan が throw する", async () => {
    const client = makeClient({
      fetchOHLCV: vi.fn().mockRejectedValue(new Error("Exchange unreachable")),
    });
    const deps = makeDeps({ client });
    await expect(runSignalScan(SYMBOL, SPOT_SYMBOL, deps)).rejects.toThrow(
      "Exchange unreachable"
    );
  });

  it("fetchSpotTicker throw → runSignalScan が throw する", async () => {
    const client = makeClient({
      fetchSpotTicker: vi.fn().mockRejectedValue(new Error("Spot ticker unavailable")),
    });
    const deps = makeDeps({ client });
    await expect(runSignalScan(SYMBOL, SPOT_SYMBOL, deps)).rejects.toThrow();
  });
});

// ── 複数候補 ────────────────────────────────────────────────────────────

describe("runSignalScan — 複数候補", () => {
  it("2候補 + マクロ通過 → alertsSent=2", async () => {
    const candidate2: TradeCandidate = {
      ...mockCandidate,
      direction: "short",
      entryHigh: 61000,
    };
    vi.mocked(analyzeConsensus).mockReturnValue({
      candidates: [mockCandidate, candidate2],
    });
    vi.mocked(assessMacroOverlay)
      .mockResolvedValueOnce({
        assessment: mockAssessment,
        decision: mockPassDecision,
      })
      .mockResolvedValueOnce({
        assessment: mockAssessment,
        decision: mockDowngradeDecision,
      });
    vi.mocked(applyMacroOverlay)
      .mockReturnValueOnce([mockCandidate])
      .mockReturnValueOnce([candidate2]);
    const deps = makeDeps();
    const result = await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    expect(result.candidatesFound).toBe(2);
    expect(result.alertsSent).toBe(2);
    expect(result.macroAction).toBe("downgrade");
  });

  it("mixed macro decisions 会按 candidate 分别持久化 macro_action", async () => {
    const candidate2: TradeCandidate = {
      ...mockCandidate,
      direction: "short",
      entryHigh: 61000,
      entryLow: 60800,
      stopLoss: 62000,
      takeProfit: 59000,
    };
    vi.mocked(analyzeConsensus).mockReturnValue({
      candidates: [mockCandidate, candidate2],
    });
    vi.mocked(assessMacroOverlay)
      .mockResolvedValueOnce({
        assessment: mockAssessment,
        decision: mockPassDecision,
      })
      .mockResolvedValueOnce({
        assessment: mockAssessment,
        decision: mockDowngradeDecision,
      });
    vi.mocked(applyMacroOverlay)
      .mockReturnValueOnce([mockCandidate])
      .mockReturnValueOnce([candidate2]);

    const deps = makeDeps();
    await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);

    const rows = deps.db.prepare(`
      SELECT direction, macro_action
      FROM candidates
      ORDER BY direction ASC
    `).all() as Array<{ direction: string; macro_action: string }>;

    expect(rows).toEqual([
      { direction: "long", macro_action: "pass" },
      { direction: "short", macro_action: "downgrade" },
    ]);
  });

  it("前一个同向候选被 macro block 时，不会占用后一个的执行暴露名额", async () => {
    const candidate2: TradeCandidate = {
      ...mockCandidate,
      entryLow: 60100,
      entryHigh: 60300,
      takeProfit: 63500,
    };
    vi.mocked(analyzeConsensus).mockReturnValue({
      candidates: [mockCandidate, candidate2],
    });
    vi.mocked(assessMacroOverlay)
      .mockResolvedValueOnce({
        assessment: mockAssessment,
        decision: mockBlockDecision,
      })
      .mockResolvedValueOnce({
        assessment: mockAssessment,
        decision: mockPassDecision,
      });
    vi.mocked(applyMacroOverlay)
      .mockReturnValueOnce([])
      .mockReturnValueOnce([candidate2]);

    const deps = makeDeps();
    const result = await runSignalScan(
      SYMBOL,
      SPOT_SYMBOL,
      deps,
      { ...strategyConfig, maxCorrelatedSignalsPerDirection: 1 }
    );

    expect(result.alertsSent).toBe(1);
    const saved = deps.db.prepare(`
      SELECT entry_high, alert_status
      FROM candidates
      ORDER BY entry_high ASC
    `).all() as Array<{ entry_high: number; alert_status: string }>;
    expect(saved).toEqual([
      { entry_high: 60300, alert_status: "sent" },
    ]);
  });

  it("snapshot 会反映同一扫描中先前已发送信号带来的暴露变化", async () => {
    const candidate2: TradeCandidate = {
      ...mockCandidate,
      entryLow: 60100,
      entryHigh: 60300,
      takeProfit: 63500,
    };
    vi.mocked(analyzeConsensus).mockReturnValue({
      candidates: [mockCandidate, candidate2],
    });
    vi.mocked(assessMacroOverlay)
      .mockResolvedValueOnce({
        assessment: mockAssessment,
        decision: mockPassDecision,
      })
      .mockResolvedValueOnce({
        assessment: mockAssessment,
        decision: mockPassDecision,
      });
    vi.mocked(applyMacroOverlay)
      .mockReturnValueOnce([mockCandidate])
      .mockReturnValueOnce([candidate2]);

    const deps = makeDeps();
    await runSignalScan(
      SYMBOL,
      SPOT_SYMBOL,
      deps,
      { ...strategyConfig, accountSizeUsd: 100_000, maxCorrelatedSignalsPerDirection: 2 }
    );

    const rows = deps.db.prepare(`
      SELECT entry_high, same_direction_exposure_count
      FROM candidate_snapshots
      ORDER BY id ASC
    `).all() as Array<{ entry_high: number; same_direction_exposure_count: number }>;

    expect(rows).toEqual([
      { entry_high: 60000, same_direction_exposure_count: 0 },
      { entry_high: 60300, same_direction_exposure_count: 1 },
    ]);
  });

  it("执行门控跳过会把 snapshot alert_status 更新为 skipped_execution_gate", async () => {
    const candidate2: TradeCandidate = {
      ...mockCandidate,
      entryLow: 60100,
      entryHigh: 60300,
      takeProfit: 63500,
    };
    vi.mocked(analyzeConsensus).mockReturnValue({
      candidates: [mockCandidate, candidate2],
    });
    vi.mocked(assessMacroOverlay)
      .mockResolvedValueOnce({
        assessment: mockAssessment,
        decision: mockPassDecision,
      })
      .mockResolvedValueOnce({
        assessment: mockAssessment,
        decision: mockPassDecision,
      });
    vi.mocked(applyMacroOverlay)
      .mockReturnValueOnce([mockCandidate])
      .mockReturnValueOnce([candidate2]);

    const deps = makeDeps();
    const result = await runSignalScan(
      SYMBOL,
      SPOT_SYMBOL,
      deps,
      { ...strategyConfig, maxCorrelatedSignalsPerDirection: 1 }
    );

    expect(result.alertsSent).toBe(1);
    expect(result.alertsSkipped).toBe(1);
    const rows = deps.db.prepare(`
      SELECT entry_high, alert_status, execution_outcome, execution_reason_code
      FROM candidate_snapshots
      ORDER BY id ASC
    `).all() as Array<{
      entry_high: number;
      alert_status: string;
      execution_outcome: string;
      execution_reason_code: string | null;
    }>;

    expect(rows).toEqual([
      {
        entry_high: 60000,
        alert_status: "sent",
        execution_outcome: "sent",
        execution_reason_code: null,
      },
      {
        entry_high: 60300,
        alert_status: "skipped_execution_gate",
        execution_outcome: "skipped_execution_gate",
        execution_reason_code: "CORRELATED_EXPOSURE_LIMIT",
      },
    ]);
  });
});

// ── ニュース API キー省略 ─────────────────────────────────────────────────

describe("runSignalScan — newsApiKey 省略", () => {
  it("newsApiKey なしでも正常に完了する", async () => {
    vi.mocked(analyzeConsensus).mockReturnValue({
      candidates: [],
      skipReasonCode: "RISK_REWARD_TOO_LOW",
    });
    const deps = makeDeps({ newsApiKey: undefined });
    const result = await runSignalScan(SYMBOL, SPOT_SYMBOL, deps);
    expect(result.candidatesFound).toBe(0);
    expect(result.errors).toHaveLength(0);
  });
});

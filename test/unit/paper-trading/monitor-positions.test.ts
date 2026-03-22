import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { initDb } from "../../../src/services/persistence/init-db.js";
import { initPositionsDb } from "../../../src/services/positions/init-positions-db.js";
import { openPosition } from "../../../src/services/positions/track-position.js";
import {
  monitorPositions,
  getUnrealizedPnl,
} from "../../../src/services/paper-trading/monitor-positions.js";
import { getOpenPositions } from "../../../src/services/positions/track-position.js";
import { logger } from "../../../src/app/logger.js";
import type { ExchangeClient } from "../../../src/clients/exchange/ccxt-client.js";
import type { TradeCandidate } from "../../../src/domain/signal/trade-candidate.js";

// ── 测试夹具 ─────────────────────────────────────────────────────────────────

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  initDb(db);
  initPositionsDb(db);
  return db;
}

function makeClient(price: number): ExchangeClient {
  return {
    fetchOHLCV: vi.fn(),
    fetchFundingRates: vi.fn(),
    fetchOpenInterest: vi.fn(),
    fetchTicker: vi.fn().mockResolvedValue({ last: price }),
    fetchSpotTicker: vi.fn(),
  } as unknown as ExchangeClient;
}

function makeCandidate(overrides: Partial<TradeCandidate> = {}): TradeCandidate {
  return {
    symbol: "BTCUSDT",
    direction: "long",
    timeframe: "4h",
    entryLow: 59800,
    entryHigh: 60000,    // entryMid = 59900, risk = 59900-58800 = 1100
    stopLoss: 58800,
    takeProfit: 63000,
    riskReward: 2.5,
    signalGrade: "high-conviction",
    regimeAligned: true,
    participantAligned: true,
    structureReason: "FVG",
    contextReason: "trend",
    reasonCodes: [],
    ...overrides,
  };
}

let db: Database.Database;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  db = makeDb();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

// ── 无仓位情况 ────────────────────────────────────────────────────────────────

describe("monitorPositions — 无仓位", () => {
  it("没有 open 仓位 → checked=0, closed=0", async () => {
    const client = makeClient(61000);
    const result = await monitorPositions(db, client, "BTC/USDT:USDT");
    expect(result.checked).toBe(0);
    expect(result.closed).toBe(0);
    expect(result.closedRecords).toHaveLength(0);
  });

  it("没有仓位时不调用 fetchTicker", async () => {
    const client = makeClient(61000);
    await monitorPositions(db, client, "BTC/USDT:USDT");
    expect(client.fetchTicker).not.toHaveBeenCalled();
  });
});

// ── long 仓位 TP ──────────────────────────────────────────────────────────────

describe("monitorPositions — long TP", () => {
  it("价格 >= takeProfit → 触发 closed_tp", async () => {
    openPosition(db, makeCandidate());
    const client = makeClient(63000); // 恰好等于 TP
    const result = await monitorPositions(db, client, "BTC/USDT:USDT");
    expect(result.closed).toBe(1);
    expect(result.closedRecords[0].status).toBe("closed_tp");
  });

  it("closed_tp: exitPrice = takeProfit", async () => {
    openPosition(db, makeCandidate());
    const client = makeClient(64000); // 超过 TP
    const result = await monitorPositions(db, client, "BTC/USDT:USDT");
    expect(result.closedRecords[0].exitPrice).toBe(63000);
  });

  it("closed_tp: pnlR > 0", async () => {
    openPosition(db, makeCandidate());
    const client = makeClient(65000);
    const result = await monitorPositions(db, client, "BTC/USDT:USDT");
    expect(result.closedRecords[0].pnlR).toBeGreaterThan(0);
  });

  it("closed_tp: pnlR ≈ (TP - entryMid) / risk = (63000-59900)/1100 ≈ 2.818", async () => {
    openPosition(db, makeCandidate());
    const client = makeClient(65000);
    const result = await monitorPositions(db, client, "BTC/USDT:USDT");
    expect(result.closedRecords[0].pnlR).toBeCloseTo(2.818, 2);
  });

  it("平仓 Telegram 返回非 2xx 时会记录警告但不影响平仓", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: vi.fn().mockResolvedValue("bot was blocked by the user"),
    });

    openPosition(db, makeCandidate());
    const client = makeClient(63000);
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);

    const result = await monitorPositions(
      db,
      client,
      "BTC/USDT:USDT",
      { telegram: { botToken: "token", chatId: "chat-id" } }
    );

    expect(result.closed).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ── long 仓位 SL ──────────────────────────────────────────────────────────────

describe("monitorPositions — long SL", () => {
  it("价格 <= stopLoss → 触发 closed_sl", async () => {
    openPosition(db, makeCandidate());
    const client = makeClient(58800); // 恰好等于 SL
    const result = await monitorPositions(db, client, "BTC/USDT:USDT");
    expect(result.closed).toBe(1);
    expect(result.closedRecords[0].status).toBe("closed_sl");
  });

  it("closed_sl: exitPrice = stopLoss", async () => {
    openPosition(db, makeCandidate());
    const client = makeClient(57000); // 低于 SL
    const result = await monitorPositions(db, client, "BTC/USDT:USDT");
    expect(result.closedRecords[0].exitPrice).toBe(58800);
  });

  it("closed_sl: pnlR ≈ -1.0R", async () => {
    openPosition(db, makeCandidate());
    const client = makeClient(57000);
    const result = await monitorPositions(db, client, "BTC/USDT:USDT");
    expect(result.closedRecords[0].pnlR).toBeCloseTo(-1.0, 1);
  });
});

// ── short 仓位 ───────────────────────────────────────────────────────────────

describe("monitorPositions — short 仓位", () => {
  it("short TP: 价格 <= takeProfit → closed_tp", async () => {
    // short: entryLow=3000, entryHigh=3100, entryMid=3050
    // stopLoss=3200, takeProfit=2800
    openPosition(
      db,
      makeCandidate({
        symbol: "ETHUSDT",
        direction: "short",
        entryLow: 3000,
        entryHigh: 3100,
        stopLoss: 3200,
        takeProfit: 2800,
      })
    );
    const client = makeClient(2800);
    const result = await monitorPositions(db, client, "ETH/USDT:USDT");
    expect(result.closedRecords[0].status).toBe("closed_tp");
    expect(result.closedRecords[0].pnlR).toBeGreaterThan(0);
  });

  it("short SL: 价格 >= stopLoss → closed_sl", async () => {
    openPosition(
      db,
      makeCandidate({
        symbol: "ETHUSDT",
        direction: "short",
        entryLow: 3000,
        entryHigh: 3100,
        stopLoss: 3200,
        takeProfit: 2800,
      })
    );
    const client = makeClient(3200);
    const result = await monitorPositions(db, client, "ETH/USDT:USDT");
    expect(result.closedRecords[0].status).toBe("closed_sl");
    expect(result.closedRecords[0].pnlR).toBeLessThan(0);
  });
});

// ── SL/TP 优先级 ──────────────────────────────────────────────────────────────

describe("monitorPositions — SL 优先", () => {
  it("价格同时触及 SL 和 TP（极端跳空行情）→ SL 优先", async () => {
    // 极端情况：价格跌到 SL 以下同时...这种情况下 TP 不会在 SL 下方，所以
    // 实际上这种情况不可能同时触发 long 的 SL 和 TP
    // 但我们测试 long SL 的保守性：价格 < SL → 一定是 closed_sl
    openPosition(db, makeCandidate());
    const client = makeClient(55000); // 远低于 SL
    const result = await monitorPositions(db, client, "BTC/USDT:USDT");
    expect(result.closedRecords[0].status).toBe("closed_sl");
  });
});

// ── 价格在 SL/TP 之间 ────────────────────────────────────────────────────────

describe("monitorPositions — 价格在区间内", () => {
  it("价格在 SL 和 TP 之间 → 不触发平仓", async () => {
    openPosition(db, makeCandidate()); // SL=58800, TP=63000
    const client = makeClient(61000); // 中间价
    const result = await monitorPositions(db, client, "BTC/USDT:USDT");
    expect(result.closed).toBe(0);
    expect(result.checked).toBe(1);
  });
});

// ── 多个仓位 ─────────────────────────────────────────────────────────────────

describe("monitorPositions — 多个仓位", () => {
  it("2 个仓位，1 个触及 TP，1 个在区间内", async () => {
    // BTC: SL=58800, TP=63000 → price=63000 触发 TP
    openPosition(db, makeCandidate({ symbol: "BTCUSDT" }));
    // ETH: SL=58000, TP=70000 → price=63000 在区间内，不触发
    openPosition(
      db,
      makeCandidate({ symbol: "ETHUSDT", entryHigh: 60100, entryLow: 59900, stopLoss: 58000, takeProfit: 70000 })
    );
    const client = makeClient(63000);
    const result = await monitorPositions(db, client, "BTC/USDT:USDT");
    expect(result.checked).toBe(2);
    expect(result.closed).toBe(1);
    expect(result.closedRecords[0].position.symbol).toBe("BTCUSDT");
  });

  it("2 个仓位都触及 TP → 全部平仓", async () => {
    // BTC: TP=63000; ETH: TP=62000 → price=65000 两个都触发
    openPosition(db, makeCandidate({ symbol: "BTCUSDT" }));
    openPosition(
      db,
      makeCandidate({ symbol: "ETHUSDT", entryHigh: 60100, entryLow: 59900, stopLoss: 58000, takeProfit: 62000 })
    );
    const client = makeClient(65000);
    const result = await monitorPositions(db, client, "BTC/USDT:USDT");
    expect(result.closed).toBe(2);
  });
});

// ── fetchTicker 失败 ─────────────────────────────────────────────────────────

describe("monitorPositions — 错误处理", () => {
  it("fetchTicker 抛出错误 → 不抛出，返回 closed=0", async () => {
    openPosition(db, makeCandidate());
    const client = {
      fetchTicker: vi.fn().mockRejectedValue(new Error("Network error")),
    } as unknown as ExchangeClient;

    await expect(
      monitorPositions(db, client, "BTC/USDT:USDT")
    ).resolves.not.toThrow();

    const result = await monitorPositions(db, client, "BTC/USDT:USDT");
    expect(result.closed).toBe(0);
    expect(result.checked).toBe(1); // 仍然知道有多少仓位
  });
});

// ── currentPrice 记录 ────────────────────────────────────────────────────────

describe("monitorPositions — currentPrice", () => {
  it("结果中包含当前价格", async () => {
    openPosition(db, makeCandidate());
    const client = makeClient(61000);
    const result = await monitorPositions(db, client, "BTC/USDT:USDT");
    expect(result.currentPrice).toBe(61000);
  });
});

// ── getUnrealizedPnl ─────────────────────────────────────────────────────────

describe("getUnrealizedPnl", () => {
  it("空仓位列表 → 空数组", () => {
    expect(getUnrealizedPnl([], 60000)).toHaveLength(0);
  });

  it("long 盈利：unrealizedPnlR > 0", () => {
    openPosition(db, makeCandidate());
    const positions = getOpenPositions(db);
    const result = getUnrealizedPnl(positions, 62000); // 价格高于 entryMid=59900
    expect(result[0].unrealizedPnlR).toBeGreaterThan(0);
  });

  it("long 亏损：unrealizedPnlR < 0", () => {
    openPosition(db, makeCandidate());
    const positions = getOpenPositions(db);
    const result = getUnrealizedPnl(positions, 59000); // 价格低于 entryMid=59900
    expect(result[0].unrealizedPnlR).toBeLessThan(0);
  });

  it("包含 distanceToTp 和 distanceToSl", () => {
    openPosition(db, makeCandidate());
    const positions = getOpenPositions(db);
    const result = getUnrealizedPnl(positions, 61000);
    expect(typeof result[0].distanceToTp).toBe("number");
    expect(typeof result[0].distanceToSl).toBe("number");
  });
});

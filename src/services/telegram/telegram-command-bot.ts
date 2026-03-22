import type { LiquiditySession } from "../../domain/market/market-context.js";
import type { OpenPosition } from "../../domain/position/open-position.js";
import { logger } from "../../app/logger.js";
import { resolvePriceRequest } from "../discord/discord-bot.js";

type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    chat?: { id: number | string };
  };
};

type TelegramGetUpdatesResponse = {
  ok: boolean;
  result?: TelegramUpdate[];
};

export type TelegramCommandBotOptions = {
  token: string;
  allowedChatId?: string;
  version: string;
  startedAt: number;
  symbol: string;
  spotSymbol: string;
  getLastScanAt: () => number | null;
  getCurrentSession: () => LiquiditySession | null;
  getOpenPositions: () => OpenPosition[];
  fetchPerpPrice: (symbol: string) => Promise<number>;
  fetchSpotPrice: (symbol: string) => Promise<number>;
};

export type TelegramCommandBotHandle = {
  stop: () => void;
};

export function startTelegramCommandBot(
  options: TelegramCommandBotOptions,
  signal?: AbortSignal
): TelegramCommandBotHandle {
  let stopped = false;
  let offset = 0;
  const localAbort = new AbortController();
  const pollingSignal = mergeSignals(signal, localAbort.signal);

  void (async () => {
    offset = await bootstrapOffset(options.token, pollingSignal);
    while (!stopped && !signal?.aborted) {
      try {
        const updates = await fetchUpdates(options.token, offset, 20, pollingSignal);
        for (const u of updates) {
          offset = getNextOffset(offset, u.update_id);
          if (!u.message?.text || !u.message?.chat?.id) continue;

          const chatId = String(u.message.chat.id);
          if (options.allowedChatId && chatId !== options.allowedChatId) continue;
          if (!isCommandMessage(u.message.text)) continue;

          const reply = await handleCommand(u.message.text, options).catch((err) => {
            logger.warn({ err }, "Telegram command handling failed");
            return "Command failed.";
          });
          if (!reply) continue;
          await sendTelegramText(options.token, chatId, reply).catch((err) => {
            logger.warn({ err, chatId }, "Telegram command reply failed");
          });
        }
      } catch (err) {
        if (isAbortError(err) || stopped || signal?.aborted) break;
        logger.warn({ err }, "Telegram command polling failed");
        await sleep(1500);
      }
    }
  })();

  logger.info("Telegram command bot started");

  return {
    stop: () => {
      stopped = true;
      localAbort.abort();
      logger.info("Telegram command bot stopped");
    },
  };
}

async function bootstrapOffset(token: string, signal?: AbortSignal): Promise<number> {
  try {
    const updates = await fetchUpdates(token, 0, 0, signal);
    return computeOffsetFromUpdates(0, updates);
  } catch (err) {
    if (isAbortError(err)) return 0;
    logger.warn({ err }, "Telegram command bot bootstrap failed, falling back to offset=0");
    return 0;
  }
}

async function fetchUpdates(
  token: string,
  offset: number,
  timeout: number,
  signal?: AbortSignal
): Promise<TelegramUpdate[]> {
  const url = `https://api.telegram.org/bot${token}/getUpdates`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      timeout,
      offset,
      allowed_updates: ["message"],
    }),
  });
  if (!res.ok) {
    throw new Error(`getUpdates ${res.status}`);
  }
  const body = (await res.json()) as TelegramGetUpdatesResponse;
  if (!body.ok || !Array.isArray(body.result)) return [];
  return body.result;
}

async function sendTelegramText(token: string, chatId: string, text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) {
    throw new Error(`sendMessage ${res.status}`);
  }
}

async function handleCommand(
  text: string,
  options: TelegramCommandBotOptions
): Promise<string | null> {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  if (!isCommandMessage(parts[0])) return null;

  const command = normalizeCommand(parts[0]);
  if (command === "/help") return formatHelpMessage();
  if (command === "/status") return formatStatusMessage(options);
  if (command === "/positions") return formatPositionsMessage(options.getOpenPositions());

  if (command === "/price") {
    const args = parsePriceArgs(parts.slice(1));
    const req = resolvePriceRequest({
      rawSymbol: args.symbol,
      rawMarket: args.market,
      defaultPerpSymbol: options.symbol,
      defaultSpotSymbol: options.spotSymbol,
    });
    try {
      const price = req.market === "perp"
        ? await options.fetchPerpPrice(req.symbol)
        : await options.fetchSpotPrice(req.symbol);
      return [
        "Latest Price",
        `Market: ${req.market}`,
        `Symbol: ${req.symbol}`,
        `Price: ${formatPrice(price)}`,
        `At (UTC): ${formatUtcTime(Date.now())}`,
      ].join("\n");
    } catch {
      return `Price fetch failed for ${req.symbol} (${req.market}).`;
    }
  }

  return "Unsupported command. Available: /help /status /positions /price [symbol] [market]";
}

export function isCommandMessage(text: string): boolean {
  return text.trim().startsWith("/");
}

function normalizeCommand(raw: string): string {
  const token = raw.trim();
  if (!token.startsWith("/")) return token;
  const atIdx = token.indexOf("@");
  return atIdx === -1 ? token.toLowerCase() : token.slice(0, atIdx).toLowerCase();
}

export function getNextOffset(currentOffset: number, updateId: number): number {
  return Math.max(currentOffset, updateId + 1);
}

export function computeOffsetFromUpdates(
  currentOffset: number,
  updates: Array<{ update_id: number }>
): number {
  let offset = currentOffset;
  for (const u of updates) offset = getNextOffset(offset, u.update_id);
  return offset;
}

export function parsePriceArgs(args: string[]): { symbol: string | null; market: string | null } {
  let symbol: string | null = null;
  let market: string | null = null;

  for (const token of args) {
    const lower = token.toLowerCase();
    if (lower === "spot" || lower === "perp") {
      market = lower;
      continue;
    }
    if (lower.startsWith("market=")) {
      const m = lower.slice("market=".length);
      if (m === "spot" || m === "perp") market = m;
      continue;
    }
    if (lower.startsWith("symbol=")) {
      symbol = token.slice("symbol=".length);
      continue;
    }
    if (!symbol) symbol = token;
  }

  return { symbol, market };
}

function formatStatusMessage(options: TelegramCommandBotOptions): string {
  const uptime = formatDuration(Date.now() - options.startedAt);
  const currentSession = options.getCurrentSession() ?? "unknown";
  const lastScanAt = options.getLastScanAt();
  const lastScanText = lastScanAt ? formatUtcTime(lastScanAt) : "not available";
  return [
    "Stratum Status",
    `Version: ${options.version}`,
    `Uptime: ${uptime}`,
    `Perp Symbol: ${options.symbol}`,
    `Spot Symbol: ${options.spotSymbol}`,
    `Session: ${currentSession}`,
    `Last Scan (UTC): ${lastScanText}`,
  ].join("\n");
}

function formatPositionsMessage(positions: OpenPosition[]): string {
  if (positions.length === 0) return "Open Positions: 0";
  const lines: string[] = [`Open Positions: ${positions.length}`];
  const maxItems = Math.min(positions.length, 8);
  for (let i = 0; i < maxItems; i++) {
    const p = positions[i];
    lines.push("");
    lines.push(`${i + 1}. ${p.direction.toUpperCase()} ${p.symbol} (${p.timeframe})`);
    lines.push(`Entry: ${formatPrice(p.entryLow)} - ${formatPrice(p.entryHigh)}`);
    lines.push(`SL: ${formatPrice(p.stopLoss)} | TP: ${formatPrice(p.takeProfit)} | RR: ${p.riskReward.toFixed(1)}:1`);
    lines.push(`Opened (UTC): ${formatUtcTime(p.openedAt)}`);
  }
  if (positions.length > maxItems) {
    lines.push("");
    lines.push(`... and ${positions.length - maxItems} more`);
  }
  return lines.join("\n");
}

function formatHelpMessage(): string {
  return [
    "Available Commands",
    "/help - show this help message",
    "/status - show runtime status",
    "/positions - show open paper-trading positions",
    "/price [symbol] [market] - latest price (market: perp|spot)",
    "Examples:",
    "/price BTC",
    "/price ETHUSDT spot",
    "/price symbol=BTCUSDT market=perp",
  ].join("\n");
}

function formatPrice(price: number): string {
  if (Math.abs(price) >= 100) {
    return price.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  return price.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function formatUtcTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return `${date} ${hh}:${mm}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

function mergeSignals(a?: AbortSignal, b?: AbortSignal): AbortSignal | undefined {
  if (!a) return b;
  if (!b) return a;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (a.aborted || b.aborted) {
    controller.abort();
    return controller.signal;
  }
  a.addEventListener("abort", onAbort, { once: true });
  b.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}

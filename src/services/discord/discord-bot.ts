import {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type RESTPostAPIApplicationCommandsJSONBody,
} from "discord.js";
import type { LiquiditySession } from "../../domain/market/market-context.js";
import type { OpenPosition } from "../../domain/position/open-position.js";
import { logger } from "../../app/logger.js";

export type DiscordBotOptions = {
  token: string;
  applicationId: string;
  guildId: string;
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

export type DiscordBotHandle = {
  stop: () => Promise<void>;
};
export type PriceMarket = "perp" | "spot";

const COMMANDS: RESTPostAPIApplicationCommandsJSONBody[] = [
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Show Stratum runtime status")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("positions")
    .setDescription("Show currently open paper-trading positions")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("price")
    .setDescription("Get latest price")
    .addStringOption((option) =>
      option
        .setName("symbol")
        .setDescription("Examples: BTC, BTCUSDT, BTC/USDT")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("market")
        .setDescription("perp (default) or spot")
        .addChoices(
          { name: "perp", value: "perp" },
          { name: "spot", value: "spot" },
        )
        .setRequired(false)
    )
    .toJSON(),
];

export async function startDiscordBot(
  options: DiscordBotOptions
): Promise<DiscordBotHandle> {
  await registerGuildCommands(options);

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, (ready) => {
    logger.info(
      { user: ready.user.tag, guildId: options.guildId },
      "Discord bot connected"
    );
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    await handleCommand(interaction, options).catch((err) => {
      logger.warn({ err, command: interaction.commandName }, "Discord command failed");
    });
  });

  await client.login(options.token);

  return {
    stop: async () => {
      client.destroy();
      logger.info("Discord bot stopped");
    },
  };
}

async function registerGuildCommands(options: DiscordBotOptions): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(options.token);
  await rest.put(
    Routes.applicationGuildCommands(options.applicationId, options.guildId),
    { body: COMMANDS }
  );
  logger.info(
    { guildId: options.guildId, commandCount: COMMANDS.length },
    "Discord guild commands registered"
  );
}

async function handleCommand(
  interaction: ChatInputCommandInteraction,
  options: DiscordBotOptions
): Promise<void> {
  if (interaction.commandName === "status") {
    const message = formatStatusMessage(options);
    await interaction.reply({ content: message });
    return;
  }

  if (interaction.commandName === "positions") {
    const message = formatPositionsMessage(options.getOpenPositions());
    await interaction.reply({ content: message });
    return;
  }

  if (interaction.commandName === "price") {
    await interaction.deferReply();
    const rawSymbol = interaction.options.getString("symbol");
    const rawMarket = interaction.options.getString("market");
    const req = resolvePriceRequest({
      rawSymbol,
      rawMarket,
      defaultPerpSymbol: options.symbol,
      defaultSpotSymbol: options.spotSymbol,
    });
    try {
      const price = req.market === "perp"
        ? await options.fetchPerpPrice(req.symbol)
        : await options.fetchSpotPrice(req.symbol);
      const message = [
        "Latest Price",
        `Market: ${req.market}`,
        `Symbol: ${req.symbol}`,
        `Price: ${formatPrice(price)}`,
        `At (UTC): ${formatUtcTime(Date.now())}`,
      ].join("\n");
      await interaction.editReply({ content: message });
    } catch (err) {
      logger.warn({ err, market: req.market, symbol: req.symbol }, "Discord price fetch failed");
      await interaction.editReply({
        content: `Price fetch failed for ${req.symbol} (${req.market}). Check symbol format or exchange availability.`,
      });
    }
  }
}

function formatStatusMessage(options: DiscordBotOptions): string {
  const now = Date.now();
  const uptime = formatDuration(now - options.startedAt);
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
  if (positions.length === 0) {
    return "Open Positions: 0";
  }

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

export function normalizePerpSymbol(input: string | null, fallback: string): string {
  const raw = (input ?? "").trim().toUpperCase();
  if (!raw) return fallback;

  if (raw.includes("/")) {
    if (raw.includes(":")) return raw;
    if (raw.endsWith("/USDT")) return `${raw}:USDT`;
    return raw;
  }

  if (raw.endsWith("USDT:USDT")) {
    const base = raw.slice(0, -"USDT:USDT".length);
    return `${base}/USDT:USDT`;
  }

  if (raw.endsWith("USDT")) {
    const base = raw.slice(0, -"USDT".length);
    return `${base}/USDT:USDT`;
  }

  return `${raw}/USDT:USDT`;
}

export function normalizeSpotSymbol(input: string | null, fallback: string): string {
  const raw = (input ?? "").trim().toUpperCase();
  if (!raw) return fallback;

  if (raw.includes("/")) {
    return raw.replace(":USDT", "");
  }

  if (raw.endsWith("USDT")) {
    const base = raw.slice(0, -"USDT".length);
    return `${base}/USDT`;
  }

  return `${raw}/USDT`;
}

export function resolvePriceRequest(input: {
  rawSymbol: string | null;
  rawMarket: string | null;
  defaultPerpSymbol: string;
  defaultSpotSymbol: string;
}): { market: PriceMarket; symbol: string } {
  const market: PriceMarket = input.rawMarket === "spot" ? "spot" : "perp";
  if (market === "spot") {
    return {
      market,
      symbol: normalizeSpotSymbol(input.rawSymbol, input.defaultSpotSymbol),
    };
  }
  return {
    market,
    symbol: normalizePerpSymbol(input.rawSymbol, input.defaultPerpSymbol),
  };
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

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
  fetchTotalEquity: () => Promise<number>;
  fetchAvailableMargin: () => Promise<number>;
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
    .setDescription("显示运行状态及账户余额")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("positions")
    .setDescription("显示当前持仓及实时盈亏")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("price")
    .setDescription("查询最新价格")
    .addStringOption((option) =>
      option
        .setName("symbol")
        .setDescription("代码示例: BTC, BTCUSDT")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("market")
        .setDescription("市场类型: perp (合约，默认) 或 spot (现货)")
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
    const [equity, margin] = await Promise.all([
      options.fetchTotalEquity().catch(() => 0),
      options.fetchAvailableMargin().catch(() => 0),
    ]);
    const message = formatStatusMessage(options, equity, margin);
    await interaction.reply({ content: message });
    return;
  }

  if (interaction.commandName === "positions") {
    const positions = options.getOpenPositions();
    if (positions.length === 0) {
      await interaction.reply({ content: "当前无持仓" });
      return;
    }
    await interaction.deferReply();
    const prices = await Promise.all(
      positions.map((p) => options.fetchPerpPrice(p.symbol).catch(() => 0))
    );
    const message = formatPositionsMessage(positions, prices);
    await interaction.editReply({ content: message });
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
        "最新价格",
        `市场: ${req.market === "perp" ? "合约" : "现货"}`,
        `交易对: ${req.symbol}`,
        `价格: ${formatPrice(price)}`,
        `时间 (UTC): ${formatUtcTime(Date.now())}`,
      ].join("\n");
      await interaction.editReply({ content: message });
    } catch (err) {
      logger.warn({ err, market: req.market, symbol: req.symbol }, "Discord price fetch failed");
      await interaction.editReply({
        content: `获取 ${req.symbol} (${req.market}) 价格失败。请检查代码格式。`,
      });
    }
  }
}

function formatStatusMessage(
  options: DiscordBotOptions,
  equity: number,
  margin: number
): string {
  const now = Date.now();
  const uptime = formatDuration(now - options.startedAt);
  const currentSession = options.getCurrentSession() ?? "未知";
  const lastScanAt = options.getLastScanAt();
  const lastScanText = lastScanAt ? formatUtcTime(lastScanAt) : "无记录";

  return [
    "Stratum 运行状态",
    `版本: ${options.version}`,
    `运行时间: ${uptime}`,
    `总资产: $${formatPrice(equity)}`,
    `可用余额: $${formatPrice(margin)}`,
    `合约代码: ${options.symbol}`,
    `现货代码: ${options.spotSymbol}`,
    `当前时段: ${translateSession(currentSession)}`,
    `最后扫描 (UTC): ${lastScanText}`,
  ].join("\n");
}

function translateSession(session: string): string {
  if (session === "asian_low") return "亚洲低流动性";
  if (session === "london_ramp") return "伦敦启动";
  if (session === "london_ny_overlap") return "伦敦纽约重叠";
  if (session === "ny_close") return "纽约尾盘";
  return session;
}

function formatPositionsMessage(positions: OpenPosition[], currentPrices: number[]): string {
  if (positions.length === 0) {
    return "当前无持仓";
  }

  const lines: string[] = [`当前持仓: ${positions.length} 笔`];
  const maxItems = Math.min(positions.length, 8);

  for (let i = 0; i < maxItems; i++) {
    const p = positions[i];
    const currentPrice = currentPrices[i];
    const entryMid = (p.entryLow + p.entryHigh) / 2;

    lines.push("");
    lines.push(`${i + 1}. ${p.direction === "long" ? "多头" : "空头"} ${p.symbol} (${p.timeframe})`);

    if (currentPrice > 0) {
      const pnlPct = p.direction === "long"
        ? (currentPrice / entryMid - 1) * 100
        : (1 - currentPrice / entryMid) * 100;
      const emoji = pnlPct >= 0 ? "🟢" : "🔴";
      const sign = pnlPct >= 0 ? "+" : "";

      if (p.notionalSize) {
        const pnlAmt = (pnlPct / 100) * p.notionalSize;
        lines.push(`盈亏: ${emoji} ${sign}$${formatPrice(pnlAmt)} (${sign}${pnlPct.toFixed(2)}%)`);
        lines.push(`仓位: $${formatPrice(p.notionalSize)} | 现价: ${formatPrice(currentPrice)}`);
      } else {
        lines.push(`盈亏: ${emoji} ${sign}${pnlPct.toFixed(2)}% | 现价: ${formatPrice(currentPrice)}`);
      }
    } else {
      if (p.notionalSize) lines.push(`仓位: $${formatPrice(p.notionalSize)}`);
    }

    lines.push(`入场: ${formatPrice(p.entryLow)} - ${formatPrice(p.entryHigh)}`);
    lines.push(`止损: ${formatPrice(p.stopLoss)} | 止盈: ${formatPrice(p.takeProfit)} | RR: ${p.riskReward.toFixed(1)}:1`);
    lines.push(`开启时间 (UTC): ${formatUtcTime(p.openedAt)}`);
  }

  if (positions.length > maxItems) {
    lines.push("");
    lines.push(`... 以及另外 ${positions.length - maxItems} 笔持仓`);
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
  const d = Math.floor(h / 24);
  const remainingH = h % 24;
  
  if (d > 0) return `${d}天 ${remainingH}小时 ${m}分`;
  if (h > 0) return `${h}小时 ${m}分`;
  return `${m}分`;
}

function formatUtcTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return `${date} ${hh}:${mm}`;
}

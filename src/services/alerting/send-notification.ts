export type TelegramConfig = {
  botToken: string;
  chatId: string;
};

export type DiscordConfig = {
  webhookUrl: string;
};

export type NotificationConfig = {
  telegram?: TelegramConfig;
  discord?: DiscordConfig;
};

export type HttpFetchFn = typeof fetch;

export type NotificationSendOptions = {
  telegramParseMode?: "Markdown" | "MarkdownV2" | "HTML";
};

export type NotificationSendResult = {
  telegram: boolean;
  discord: boolean;
  anyDelivered: boolean;
};

const TELEGRAM_API = "https://api.telegram.org";
const DISCORD_MESSAGE_LIMIT = 2000;

export function hasNotificationChannel(config?: NotificationConfig): boolean {
  if (!config) return false;
  const hasTelegram = Boolean(config.telegram?.botToken && config.telegram?.chatId);
  const hasDiscord = Boolean(config.discord?.webhookUrl);
  return hasTelegram || hasDiscord;
}

export async function sendTextNotification(
  text: string,
  config: NotificationConfig,
  httpFetch: HttpFetchFn = fetch,
  options: NotificationSendOptions = {}
): Promise<NotificationSendResult> {
  const telegramPromise = config.telegram?.botToken && config.telegram?.chatId
    ? sendTelegramText(text, config.telegram, httpFetch, options.telegramParseMode)
    : Promise.resolve(false);

  const discordPromise = config.discord?.webhookUrl
    ? sendDiscordText(text, config.discord, httpFetch)
    : Promise.resolve(false);

  const [telegram, discord] = await Promise.all([telegramPromise, discordPromise]);
  return {
    telegram,
    discord,
    anyDelivered: telegram || discord,
  };
}

async function sendTelegramText(
  text: string,
  config: TelegramConfig,
  httpFetch: HttpFetchFn,
  parseMode?: NotificationSendOptions["telegramParseMode"],
): Promise<boolean> {
  const url = `${TELEGRAM_API}/bot${config.botToken}/sendMessage`;
  try {
    const body: Record<string, string> = {
      chat_id: config.chatId,
      text,
    };
    if (parseMode) body.parse_mode = parseMode;

    const res = await httpFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function sendDiscordText(
  text: string,
  config: DiscordConfig,
  httpFetch: HttpFetchFn,
): Promise<boolean> {
  const chunks = splitDiscordMessage(text, DISCORD_MESSAGE_LIMIT);
  try {
    for (const chunk of chunks) {
      const res = await httpFetch(config.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: chunk }),
      });
      if (!res.ok) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function splitDiscordMessage(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > limit) {
    const slice = remaining.slice(0, limit);
    const breakAt = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(" "));
    const splitAt = breakAt > limit * 0.6 ? breakAt : limit;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

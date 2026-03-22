import type { AlertPayload } from "../../domain/signal/alert-payload.js";
import type { PositionSizingSummary } from "../../domain/signal/position-sizing.js";
import { formatAlert } from "./format-alert.js";

/**
 * Telegram 告警发送器  (PHASE_08)
 *
 * 职责：
 *   接收 `AlertPayload`，先通过 `formatAlert` 生成文本，再调用
 *   Telegram Bot API 的 `/sendMessage` 接口发送。
 *
 * 设计约束：
 *   - `botToken` / `chatId` 通过参数注入，便于测试；
 *   - `fetch` 通过参数注入，测试时可直接 mock；
 *   - 发送失败返回 `false`，不向上抛异常，避免阻断主扫描链路。
 *
 * 额外说明：
 *   - Telegram 单条消息上限为 4096 字符；
 *   - 频率限制由调用方控制，本函数只负责单次发送。
 */

export type TelegramConfig = {
  botToken: string;
  chatId: string;
};

export type HttpFetchFn = typeof fetch;
export type SendAlertOptions = {
  positionSizing?: PositionSizingSummary;
};

const TELEGRAM_API = "https://api.telegram.org";

export async function sendAlert(
  payload: AlertPayload,
  config: TelegramConfig,
  httpFetch: HttpFetchFn = fetch,
  options: SendAlertOptions = {}
): Promise<boolean> {
  if (!config.botToken || !config.chatId) return false;

  const text = formatAlert(
    payload.candidate,
    payload.marketContext,
    options.positionSizing
  );
  const url = `${TELEGRAM_API}/bot${config.botToken}/sendMessage`;

  try {
    const res = await httpFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: config.chatId, text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

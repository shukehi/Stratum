import type { AlertPayload } from "../../domain/signal/alert-payload.js";
import type { PositionSizingSummary } from "../../domain/signal/position-sizing.js";
import { formatAlert } from "./format-alert.js";
import {
  sendTextNotification,
  type HttpFetchFn,
  type NotificationConfig,
} from "./send-notification.js";

export type {
  DiscordConfig,
  HttpFetchFn,
  NotificationConfig,
  TelegramConfig,
} from "./send-notification.js";

/**
 * Telegram 告警发送器  (PHASE_08)
 *
 * 职责：
 *   接收 `AlertPayload`，先通过 `formatAlert` 生成文本，再调用
 *   通知通道（Telegram / Discord）发送。
 *
 * 设计约束：
 *   - 通知通道配置通过参数注入，便于测试；
 *   - `fetch` 通过参数注入，测试时可直接 mock；
 *   - 发送失败返回 `false`，不向上抛异常，避免阻断主扫描链路。
 *
 * 额外说明：
 *   - Telegram / Discord 的限额差异由底层发送器处理；
 *   - 频率限制由调用方控制，本函数只负责单次发送。
 */
export type SendAlertOptions = {
  positionSizing?: PositionSizingSummary;
};

export async function sendAlert(
  payload: AlertPayload,
  config: NotificationConfig,
  httpFetch: HttpFetchFn = fetch,
  options: SendAlertOptions = {}
): Promise<boolean> {
  const text = formatAlert(
    payload.candidate,
    payload.marketContext,
    options.positionSizing
  );
  const result = await sendTextNotification(text, config, httpFetch);
  return result.anyDelivered;
}

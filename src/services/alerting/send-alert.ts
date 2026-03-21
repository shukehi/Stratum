import type { AlertPayload } from "../../domain/signal/alert-payload.js";
import type { PositionSizingSummary } from "../../domain/signal/position-sizing.js";
import { formatAlert } from "./format-alert.js";

/**
 * Telegram アラート送信  (PHASE_08)
 *
 * 職責:
 *   AlertPayload を受け取り、formatAlert でテキスト化して
 *   Telegram Bot API (/sendMessage) に POST する。
 *
 * 設計:
 *   - botToken / chatId は外部から注入（env を直接参照しない → テスト容易性）
 *   - fetch は httpFetch パラメータとして注入（テストでモック可能）
 *   - 送信成功 → true; HTTP エラー / ネットワーク失敗 → false（throw しない）
 *
 * 制限:
 *   - Telegram メッセージ上限 4096 文字（formatAlert 出力は ~500 文字以内）
 *   - Rate limit は呼び出し元が制御する（1 秒あたり 30 メッセージ上限）
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

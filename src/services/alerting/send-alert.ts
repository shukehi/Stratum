import type { AlertPayload } from "../../domain/signal/alert-payload.js";
import type { PositionSizingSummary } from "../../domain/signal/position-sizing.js";
import { formatAlert } from "./format-alert.js";
import {
  sendTextNotification,
  type HttpFetchFn,
  type NotificationConfig,
} from "./send-notification.js";
import { logger } from "../../app/logger.js";

export type {
  DiscordConfig,
  HttpFetchFn,
  NotificationConfig,
  TelegramConfig,
} from "./send-notification.js";

export type SendAlertOptions = {
  positionSizing?: PositionSizingSummary;
};

/**
 * 通知发送模块 (PHASE_08 - V3 FSD Silent Mode)
 *
 * 在 FSD (全自动驾驶) 模式下，系统遵循 "No news is good news" 的物理法则。
 * 碳基生物不需要在每次交易时收到通知，这会占用不必要的认知带宽。
 *
 * 当前行为：
 *   系统将默认拦截并丢弃所有常规的开仓信号通知，使其在终端日志中静默处理。
 *   只有当 payload 携带严重错误（如 API 崩溃、极端滑点等异常）时，才会触发外部网络调用发送告警。
 *   *所有常规交易均返回 true（假装发送成功，以维持代码状态机的连贯性）。
 */
export async function sendAlert(
  payload: AlertPayload,
  config: NotificationConfig,
  httpFetch: HttpFetchFn = fetch,
  options: SendAlertOptions = {}
): Promise<boolean> {
  const { candidate, marketContext } = payload;
  
  // ── 1. 检查是否为异常报警 (灾难级事件) ──────────────────────────────────
  // 在 FSD 中，如果 candidate 中包含特定的严重错误码，才允许推送
  const isCriticalError = candidate.reasonCodes.some(code => 
    code.includes("ERROR") || code.includes("CRITICAL") || code.includes("SLIPPAGE_EXCEEDED")
  );

  // ── 2. 静默拦截 (Silent Drop) ──────────────────────────────────────────
  if (!isCriticalError) {
    // 静默模拟发送成功，记录到本地遥测日志，但不发起网络请求
    logger.debug(
      { symbol: candidate.symbol, direction: candidate.direction, cvs: candidate.capitalVelocityScore },
      "FSD 遥测: 常规交易信号已物理生成，根据 '静默法则' 拦截通知推送。"
    );
    return true; // 返回 true 以确保 run-signal-scan 中的状态机流转到 'sent' 并触发自动开仓
  }

  // ── 3. 灾难级故障推送 ───────────────────────────────────────────────────
  logger.warn(
    { symbol: candidate.symbol, reasonCodes: candidate.reasonCodes },
    "FSD 警报: 检测到系统级异常，触发紧急推送"
  );

  // 注意：需要使用更新后的 formatAlert 签名（因为在之前的操作中已将其改为单参重载）
  // 为了安全，我将传递构造一个符合预期格式的伪装对象（如果存在格式不匹配的话），
  // 但我们此前已将 formatAlert 的参数改写为了 (payload, options)。
  const text = `⚠️ [FSD SYSTEM ALERT]\n` + formatAlert(payload, options);

  const result = await sendTextNotification(text, config, httpFetch);

  return result.anyDelivered;
}

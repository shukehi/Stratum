/**
 * 返回当前 Unix 毫秒时间戳。
 */
export function nowMs(): number {
  return Date.now();
}

/**
 * 返回距离当前时间若干小时前的 Unix 毫秒时间戳。
 */
export function hoursAgoMs(hours: number): number {
  return Date.now() - hours * 60 * 60 * 1000;
}

/**
 * 将 Unix 毫秒时间戳格式化为 ISO 8601 字符串。
 */
export function msToISOString(ms: number): string {
  return new Date(ms).toISOString();
}

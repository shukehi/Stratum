/**
 * 将数值限制在给定区间内。
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 按指定小数位四舍五入。
 */
export function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * 计算相对变化比例。
 *
 * 返回值为小数形式，例如 0.1 表示上涨 10%。
 */
export function percentChange(from: number, to: number): number {
  if (from === 0) return 0;
  return (to - from) / from;
}

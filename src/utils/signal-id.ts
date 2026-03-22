/**
 * 生成跨模块复用的信号主键。
 *
 * 设计目标：
 *   - `candidates` 与 `positions` 使用完全一致的 ID 规则；
 *   - 避免低价资产在 `Math.floor(entryHigh)` 下全部退化为 `0`；
 *   - 对高价与低价资产都保留稳定且足够的价格精度。
 */
export function buildSignalId(
  symbol: string,
  direction: string,
  timeframe: string,
  entryHigh: number
): string {
  return `${symbol}_${direction}_${timeframe}_${entryHigh.toFixed(8)}`;
}

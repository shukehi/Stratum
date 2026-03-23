/**
 * 信号唯一标识生成器 (V2 Physics)
 * 
 * 物理准则：
 *   同一品种、同一方向、同一时间框架在同一价格点发出的信号应具有相同的物理指纹。
 */
export function buildSignalId(
  symbol: string,
  direction: string,
  timeframe: string,
  entryHigh: number
): string {
  // 标准化价格，保留 8 位小数以防浮点数抖动
  const priceKey = entryHigh.toFixed(8);
  return `${symbol}_${direction}_${timeframe}_${priceKey}`;
}

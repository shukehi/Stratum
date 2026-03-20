# Review Phase 04: Participant Pressure

## 1. 复审目标

确认参与者压力层真的在建模“谁在加杠杆、谁在被迫平仓、谁可能被挤压”，而不是退回成价格情绪标签。

## 2. 复审范围

- `src/domain/participants/*`
- `src/services/participants/*`
- `src/domain/market/market-context.ts`
- 对应测试

## 3. 工程复审问题

1. 输出是否包含 `bias`、`pressureType`、`confidence`、`rationale`、`spotPerpBasis`、`basisDivergence`、`reasonCodes`。
2. 是否保留了 `participantConfidence`、`participantRationale`、`spotPerpBasis`、`basisDivergence`、`liquiditySession` 到 `MarketContext`。
3. 真空期规则是否配置化。
4. 基差背离阈值 `basisDivergenceThreshold` 是否配置化。
5. `detectLiquiditySession()` 是否正确覆盖四个时段。

## 4. 第一性原理复审问题

1. 代码是否真的区分”新开仓推动”和”平仓驱动”。
2. 是否能识别 long liquidation cascade 后的真空期。
3. 是否错误地把”价格跌 + OI 跌”解释成更强的空头拥挤。
4. 是否真的在回答”谁被迫交易”，而不是只回答”价格往哪走”。
5. 是否利用了现货-永续基差来检测合约端与现货端的行为不一致。
6. funding 负值 + 现货溢价时，是否正确识别为 squeeze-risk 增强信号。

## 5. 常见失败模式

- 把所有 `价格涨 + OI涨` 简化成做多
- 把所有 `价格跌 + OI跌` 简化成做空
- 丢失真空期标记
- `MarketContext` 不保留参与者置信度
- 忽略现货-永续基差，导致只看合约端单边信息
- `spotPrice = 0` 时未做降级处理，而是报错崩溃

## 6. 通过标准

- 四类价格/OI 关系均有明确行为
- 真空期会触发跳过逻辑
- 基差背离检测生效，且在现货数据不可用时优雅降级
- `MarketContext` 保留完整参与者上下文（含基差和时段）

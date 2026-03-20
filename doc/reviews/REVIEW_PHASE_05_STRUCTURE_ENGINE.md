# Review Phase 05: Structure Engine

## 1. 复审目标

确认结构层只负责位置选择与失效边界，而不是重新变成交易决策主脑。

## 2. 复审范围

- `src/domain/signal/*`
- `src/services/structure/*`
- 对应测试

## 3. 工程复审问题

1. `StructuralSetup` 是否包含 `structureScore`、`reasonCodes`、`confluenceFactors`、`confirmationStatus`、`confirmationTimeframe`。
2. 结构层是否接收 `MarketContext`（含 `liquiditySession`）。
3. 结构层是否在低状态置信度或真空期返回空数组。
4. 是否区分 FVG 回踩和流动性池 sweep。
5. 复合结构检测是否正确识别多种结构类型的价格区域重叠。
6. 入场确认机制是否正确实现 `pending -> confirmed / invalidated` 状态转换。
7. 交易时段修正是否在 `asian_low` 折扣、`london_ramp` 加成。

## 4. 第一性原理复审问题

1. 结构层是否越权解释”为什么市场会动”。
2. 是否又把 FVG 偷偷当成主要 alpha 来源。
3. 对流动性池是否加入了收盘确认，而不是首次触碰即触发。
4. 是否把 sweep 和真实跌破混为一谈。
5. 是否识别了多重结构汇聚（confluence）并给予评分加成。
6. 入场区域是否要求”拒绝信号”才确认，而不是触碰即触发。
7. 是否考虑了不同流动性时段对虚假突破概率的影响。

## 5. 常见失败模式

- 结构层输出最终信号等级
- 结构层直接访问宏观结果
- 没有 4h 收盘确认
- sweep 和 FVG 共用触发逻辑
- 忽略 confluence，所有结构评分相同权重
- 触碰入场区域即视为 confirmed，没有等待拒绝信号
- 不区分亚盘和伦敦时段的结构可信度

## 6. 通过标准

- 结构层只输出位置、边界、结构评分、confluence 和确认状态
- 4h 收盘确认规则生效
- 复合结构加分规则生效
- 入场确认机制区分 pending / confirmed / invalidated
- 交易时段修正生效
- 结构层不越权做决策

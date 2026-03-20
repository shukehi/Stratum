# Review Phase 03: Regime Engine

## 1. 复审目标

确认市场状态层真的在回答“当前环境是否适合交易”，而不是给价格行为贴标签。

## 2. 复审范围

- `src/domain/regime/*`
- `src/services/regime/*`
- `src/app/config.ts`
- 对应测试

## 3. 工程复审问题

1. `detectMarketRegime()` 是否返回 `RegimeDecision` 而不是裸枚举。
2. 是否输出 `confidence`、`reasons`、`reasonCodes`。
3. 状态评分是否配置化。
4. 是否实现了固定的状态优先级和歧义处理。

## 4. 第一性原理复审问题

1. 该模块是否真的在判断环境，而不是只看涨跌斜率。
2. 是否存在趋势末端加速反而被打更高分的问题。
3. `event-driven` 是否只依赖 MVP 可用数据，而没有伪造未来事件信息。
4. 状态输出是否足够强，可以控制结构层是否运行。

## 5. 常见失败模式

- 只用几条 `if/else` 判断 trend/range
- 没有衰竭惩罚
- 没有 `minRegimeScoreGap`
- 状态结果无法阻断后续结构层

## 6. 通过标准

- 状态层输出完整可解释对象
- 趋势末端不会继续抬高趋势置信度
- 歧义状态会降置信度并标记
- 状态层具备控制后续层的能力

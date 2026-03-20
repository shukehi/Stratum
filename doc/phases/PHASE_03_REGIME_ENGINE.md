# Phase 03: Regime Engine

## 1. 目标

实现市场状态识别层，使系统在进入结构扫描前先判断当前环境是否可交易。

## 2. 前置依赖

- `PHASE_01_PROJECT_BOOTSTRAP`
- `PHASE_02_MARKET_DATA_PIPELINE`

## 3. 允许修改范围

- `src/domain/common/*`
- `src/domain/regime/*`
- `src/domain/market/market-context.ts`
- `src/services/regime/*`
- `src/app/config.ts`
- `test/unit/regime/*`
- `test/fixtures/*`

## 4. 交付物

- `MarketRegime`
- `src/domain/common/reason-code.ts`
- `RegimeDecision`
- `detectMarketRegime()`

## 5. 任务清单

1. 定义 `MarketRegime`。
2. 在 `src/domain/common/reason-code.ts` 中定义与状态层相关的 `ReasonCode` 枚举值。
3. 定义 `RegimeDecision`。
4. 实现状态评分结构：`trend`、`range`、`event-driven`、`high-volatility`。
5. 加入趋势衰竭惩罚。
6. 实现固定优先级选择规则：
   - `event-driven` 覆盖 `high-volatility`
   - `high-volatility` 覆盖 `trend/range`
7. 实现 `minRegimeScoreGap` 歧义处理。
8. 为每类 regime 写测试。

## 6. 禁止事项

- 不实现参与者压力层
- 不实现结构扫描
- 不接 Telegram
- 不接数据库

## 7. 验收标准

- `detectMarketRegime()` 返回 `RegimeDecision`。
- 输出包含 `confidence`、`reasons`、`reasonCodes`。
- 存在趋势、震荡、高波动、事件驱动的样本测试。
- 存在“趋势末端衰竭不应继续抬高 trend 分数”的测试。

# Phase 05: Structure Engine

## 1. 目标

在状态层和参与者层通过后，实现结构触发层，只负责给出位置、失效边界、结构评分、复合结构检测、入场确认机制和交易时段修正。

## 2. 前置依赖

- `PHASE_01_PROJECT_BOOTSTRAP`
- `PHASE_02_MARKET_DATA_PIPELINE`
- `PHASE_03_REGIME_ENGINE`
- `PHASE_04_PARTICIPANT_PRESSURE`

## 3. 允许修改范围

- `src/domain/common/*`
- `src/domain/signal/*`
- `src/services/structure/*`
- `src/app/config.ts`
- `test/unit/structure/*`
- `test/fixtures/*`

## 4. 交付物

- `StructuralSetup`（含 `confluenceFactors`、`confirmationStatus`、`confirmationTimeframe`）
- `ConfluenceFactor`
- `detectFvg()`
- 流动性池或前高前低识别
- `detectConfluence()`
- `confirmEntry()`
- `detectStructuralSetups()`

## 5. 任务清单

1. 定义 `StructuralSetup`，包含 `structureScore`、`reasonCodes`、`confluenceFactors`、`confirmationStatus`、`confirmationTimeframe`。
2. 定义 `ConfluenceFactor` 类型。
3. 实现 FVG 检测。
4. 实现前高前低流动性池识别。
5. 实现结构评分。
6. 在 `src/domain/common/reason-code.ts` 中加入结构层新增的 `ReasonCode`（含 `STRUCTURE_CONFLUENCE_BOOST`、`STRUCTURE_CONFIRMATION_PENDING`、`STRUCTURE_CONFIRMATION_INVALIDATED`、`SESSION_LOW_LIQUIDITY_DISCOUNT`），并对流动性池 setup 加入 `4h` 收盘确认。
7. 区分 FVG 回踩和 sweep 结构，不得共用触发逻辑。
8. 让结构层接收 `MarketContext`（含 `liquiditySession`），并在低 `regimeConfidence` 或真空期直接返回空数组。
9. 实现复合结构（Confluence）检测：
   - 检测多种结构类型在同一价格区域的重叠
   - 2 种叠加加 `confluenceBonus`（默认 `10` 分）
   - 3 种及以上加 `confluenceBonus × 1.5`（默认 `15` 分）
   - 流动性 sweep 后同区域留下新 FVG 加 `confluenceBonus × 2`（默认 `20` 分）
   - 加分后上限为 `100`
   - `confluenceFactors.length >= 2` 时附加 `STRUCTURE_CONFLUENCE_BOOST`
10. 实现入场区域确认机制：
    - 初始状态为 `pending`
    - 做多确认：`1h` K 线下影线占总振幅比例 `>= confirmationShadowRatio`（默认 `0.5`），或连续 `confirmationCandles`（默认 `2`）根不创新低
    - 做空确认：对称逻辑
    - 失效条件：`1h` 收盘穿透 `stopLossHint` → `invalidated`
    - 已 `invalidated` 不再重复触发
11. 实现交易时段流动性修正：
    - `asian_low` 时段 `structureScore` 乘以 `sessionDiscountFactor`（默认 `0.8`）
    - `london_ramp` 时段乘以 `sessionPremiumFactor`（默认 `1.1`）
    - `enableSessionAdjustment = false` 时所有修正系数为 `1.0`

## 6. 禁止事项

- 不输出最终仓位
- 不输出最终信号等级
- 不访问宏观语义结果
- 不接数据库

## 7. 验收标准

- FVG 检测有单元测试。
- sweep 有正反测试：
  - 刺破并 `4h` 收回 -> 有效
  - 刺破但未收回 -> 无效
- 复合结构测试：
  - FVG + 流动性池重叠 -> `confluenceFactors` 包含两项且 `structureScore` 加分
  - 流动性 sweep 后同区域出现 FVG -> 最高优先级加分
- 入场确认测试：
  - 价格进入区域 + `1h` 出现长下影线 -> `confirmed`
  - 价格进入区域 + `1h` 收盘穿透止损 -> `invalidated`
  - 价格未进入区域 -> `pending`
- 交易时段测试：
  - `asian_low` 时段 `structureScore` 被折扣
  - `london_ramp` 时段 sweep 的 `structureScore` 被加成
- `structureScore < minStructureScore` 的 setup 可被识别并在后续被过滤。
- 结构层在真空期或低状态置信度下返回空数组。

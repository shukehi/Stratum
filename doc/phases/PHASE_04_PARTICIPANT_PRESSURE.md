# Phase 04: Participant Pressure

## 1. 目标

实现参与者压力层，用 funding、OI、价格联动关系和现货-永续基差判断仓位拥挤、挤压风险与去杠杆真空。

## 2. 前置依赖

- `PHASE_01_PROJECT_BOOTSTRAP`
- `PHASE_02_MARKET_DATA_PIPELINE`
- `PHASE_03_REGIME_ENGINE`

## 3. 允许修改范围

- `src/domain/common/*`
- `src/domain/participants/*`
- `src/domain/market/market-context.ts`
- `src/services/participants/*`
- `src/utils/session.ts`
- `src/app/config.ts`
- `test/unit/participants/*`
- `test/fixtures/*`

## 4. 交付物

- `ParticipantPressure`（含 `spotPerpBasis`、`basisDivergence`）
- `LiquiditySession`
- `assessParticipantPressure()`
- `buildMarketContext()` 或等效组合函数
- `detectLiquiditySession()` 时段识别工具函数

## 5. 任务清单

1. 定义 `ParticipantPressure`，包含 `spotPerpBasis` 和 `basisDivergence` 字段。
2. 定义 `LiquiditySession` 类型（`asian_low` / `london_ramp` / `london_ny_overlap` / `ny_close`）。
3. 实现 `detectLiquiditySession()`，基于当前 UTC 时间返回流动性时段。
4. 用价格/OI 联动区分扩张与去杠杆。
5. 用 funding 方向与变化速度增强拥挤判断。
6. 实现 `long-crowded`、`short-crowded`、`balanced`。
7. 实现 `flush-risk`、`squeeze-risk`、`none`。
8. 实现 `oiCollapseVacuumThresholdPercent` 规则。
9. 实现现货-永续基差背离检测：
   - 计算 `spotPerpBasis = (spotPrice - perpPrice) / spotPrice`
   - 当 `|spotPerpBasis| >= basisDivergenceThreshold` 且基差方向与 funding rate 方向相反时，标记 `basisDivergence = true`
   - `basisDivergence = true` 时，对应方向的 `pressureType` 置信度上调 `basisDivergenceConfidenceBoost`（默认 `12` 分）
   - 若现货数据不可用（`spotPrice = 0`），`spotPerpBasis` 默认为 `0`，`basisDivergence` 默认为 `false`
10. 在 `src/domain/common/reason-code.ts` 中补充 `DELEVERAGING_VACUUM` 和 `PARTICIPANT_BASIS_DIVERGENCE`。
11. 生成 `MarketContext`，保留 `participantConfidence`、`participantRationale`、`spotPerpBasis`、`basisDivergence`、`liquiditySession`。

## 6. 禁止事项

- 不实现结构层
- 不实现共识层
- 不接 LLM
- 不写数据库

## 7. 验收标准

- 至少覆盖四类基本样本：
  - 价格涨 + OI 涨
  - 价格跌 + OI 涨
  - 价格涨 + OI 跌
  - 价格跌 + OI 跌
- 至少有一个”价格急跌 + OI 大幅下降 -> 去杠杆真空”的测试。
- 至少有一个”funding 负值 + 现货溢价 -> squeeze-risk 置信度上调”的基差背离测试。
- 至少有一个”funding 正值 + 期货溢价 -> flush-risk 置信度上调”的基差背离测试。
- `MarketContext` 不丢失 `reasonCodes`、`participantConfidence`、`participantRationale`、`spotPerpBasis`、`basisDivergence`、`liquiditySession`。
- `detectLiquiditySession()` 有覆盖四个时段的测试。

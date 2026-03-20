# Phase 06: Consensus And Risk

## 1. 目标

实现共识层和风控层，把状态、参与者、结构整合成可交易或应跳过的候选交易。

## 2. 前置依赖

- `PHASE_01_PROJECT_BOOTSTRAP`
- `PHASE_02_MARKET_DATA_PIPELINE`
- `PHASE_03_REGIME_ENGINE`
- `PHASE_04_PARTICIPANT_PRESSURE`
- `PHASE_05_STRUCTURE_ENGINE`

## 3. 允许修改范围

- `src/domain/common/*`
- `src/services/consensus/*`
- `src/services/risk/*`
- `src/domain/signal/*`
- `src/app/config.ts`
- `test/unit/consensus/*`
- `test/unit/risk/*`

## 4. 交付物

- `computeRiskReward()`
- `computePositionSize()`
- `evaluateConsensus()`
- `TradeCandidate`

## 5. 任务清单

1. 定义 `TradeCandidate`。
2. 实现风险回报比计算（阈值推导见主文档 §15.0）。
3. 实现固定风险仓位计算。
4. 在共识层按顺序检查：
   - `regimeConfidence`
   - `participantConfidence`
   - 真空期
   - `structureScore`
   - `confirmationStatus`
   - `riskReward`
5. 实现 `confirmationStatus` 过滤规则：
   - 只有 `confirmed` 的 setup 进入正式评级
   - `pending` 的 setup 最高只能输出 `watch` 级别预警
   - `invalidated` 的 setup 直接丢弃
6. 实现 `watch`、`standard`、`high-conviction` 分级。
7. 实现配置化的 skip / downgrade 规则。
8. 在 `src/domain/common/reason-code.ts` 中补充共识层与风控层需要的 `ReasonCode`，并为每个候选附加 `reasonCodes`。

## 6. 禁止事项

- 不接 LLM
- 不写数据库
- 不接 Telegram

## 7. 验收标准

- 低 `regimeConfidence` 被过滤。
- 真空期被过滤。
- `structureScore < minStructureScore` 被过滤。
- `riskReward < minimumRiskReward` 被过滤。
- `confirmationStatus === "invalidated"` 被丢弃。
- `confirmationStatus === "pending"` 最高只能输出 `watch`。
- 弱参与者但强结构最多只能输出 `watch`。

# Phase 32: Attribution And Full-Chain Backtest

## 1. 目标

补齐“不交易归因”“被 block 样本保留”和“全链路回测”三件事。

本阶段完成后，系统必须能回答：

- 为什么这次没信号
- 为什么这个机会被 block
- 如果不过滤，它后来表现如何
- 哪一层判断最常导致亏损

## 2. 前置依赖

- `PHASE_31_CAUSAL_GATING_AND_CANDIDATE_MACRO`
- 当前 `PHASE_08_PERSISTENCE_AND_ALERTING`
- 当前 `PHASE_10-C` 回测能力

## 3. 允许修改范围

- `src/services/persistence/*`
- `src/services/orchestrator/*`
- `src/services/analytics/*`
- `src/services/backtest/*`
- `src/domain/backtest/*`
- `src/domain/common/*`
- `src/domain/signal/*`
- `src/domain/market/*`
- `src/app/config.ts`
- `src/cli/*`
- `test/unit/persistence/*`
- `test/unit/analytics/*`
- `test/unit/backtest/*`
- `test/unit/orchestrator/*`

## 4. 交付物

- 结构化 skip / block 数据模型
- 被 block 候选的持久化能力
- 全链路 walk-forward backtest
- 分层报表查询

## 5. 任务清单

1. 为扫描结果和候选持久化增加以下能力：
   - `skipStage`
   - `skipReasonCode`
   - `macroAction`
   - `confirmationStatus`
   - `dailyBias`
   - `orderFlowBias`
   - regime / participant 快照
2. 即使 candidate 被宏观 block，也要保留到数据库中，并标记为 `blocked_by_macro`。
3. 对“没有 candidate”的扫描周期保存结构化 skip 信息，而不是只保存汇总计数。
4. 重构回测，让其按真实顺序重放：
   - regime
   - participants
   - structure
   - risk
   - macro
5. 将当前“仅结构回测”保留为单独模式，但不得再冒充系统回测。
6. 为 analytics 增加按以下维度分组统计的能力：
   - regime
   - participant pressure
   - confirmation status
   - confluence count
   - basis divergence
   - macro action
   - skip stage

## 6. 禁止事项

- 不得丢弃 `block` 样本
- 不得只记录 `no signal` 文本而不记录结构化原因
- 不得继续用绕过 regime/participant 的结构回测代表全系统表现
- 不得引入自动调参

## 7. 验收标准

- 所有无信号扫描周期都具备结构化 skip reason。
- 所有被 block 的 candidate 都能在数据库中查询到。
- 可以单独统计 `blocked_by_macro` 样本的后验胜率。
- 全链路回测结果与实时执行的过滤顺序一致。
- analytics 能输出至少以下报表：
  - 按 regime 分组
  - 按 participant pressure 分组
  - 按 macro action 分组
  - 按 confirmation status 分组

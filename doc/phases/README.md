# Stratum 阶段开发索引

## 1. 目的

本目录用于把 Stratum 的总架构文档拆解为可直接分配给 AI 编程助手的阶段施工单。

适用对象：

- Codex
- Claude Code
- 其他具备代码编辑能力的 AI 助手

使用原则：

1. 一次只执行一个阶段。
2. 未完成当前阶段验收前，不得进入下一阶段。
3. 每个阶段只允许修改该阶段列出的文件范围。
4. 若当前阶段需要的数据或类型尚不存在，应先完成前置阶段，而不是跳过依赖。
5. 共享类型或共享枚举只允许修改被当前阶段明确授权的共享位置，不得在阶段内复制一份替代实现。

## 2. 阶段顺序

1. [PHASE_01_PROJECT_BOOTSTRAP.md](/Users/aries/Dve/crypto/Stratum/doc/phases/PHASE_01_PROJECT_BOOTSTRAP.md)
2. [PHASE_02_MARKET_DATA_PIPELINE.md](/Users/aries/Dve/crypto/Stratum/doc/phases/PHASE_02_MARKET_DATA_PIPELINE.md)
3. [PHASE_03_REGIME_ENGINE.md](/Users/aries/Dve/crypto/Stratum/doc/phases/PHASE_03_REGIME_ENGINE.md)
4. [PHASE_04_PARTICIPANT_PRESSURE.md](/Users/aries/Dve/crypto/Stratum/doc/phases/PHASE_04_PARTICIPANT_PRESSURE.md)
5. [PHASE_05_STRUCTURE_ENGINE.md](/Users/aries/Dve/crypto/Stratum/doc/phases/PHASE_05_STRUCTURE_ENGINE.md)
6. [PHASE_06_CONSENSUS_AND_RISK.md](/Users/aries/Dve/crypto/Stratum/doc/phases/PHASE_06_CONSENSUS_AND_RISK.md)
7. [PHASE_07_MACRO_OVERLAY.md](/Users/aries/Dve/crypto/Stratum/doc/phases/PHASE_07_MACRO_OVERLAY.md)
8. [PHASE_08_PERSISTENCE_AND_ALERTING.md](/Users/aries/Dve/crypto/Stratum/doc/phases/PHASE_08_PERSISTENCE_AND_ALERTING.md)
9. [PHASE_09_WORKFLOWS_AND_REVIEW.md](/Users/aries/Dve/crypto/Stratum/doc/phases/PHASE_09_WORKFLOWS_AND_REVIEW.md)

## 2A. 后续优化阶段

以下阶段用于修正当前实现与“交易第一性原理闭环”之间的偏差。

1. [PHASE_30_MECHANISM_REGIME_REFACTOR.md](/Users/aries/Dve/crypto/Stratum/doc/phases/PHASE_30_MECHANISM_REGIME_REFACTOR.md)
2. [PHASE_31_CAUSAL_GATING_AND_CANDIDATE_MACRO.md](/Users/aries/Dve/crypto/Stratum/doc/phases/PHASE_31_CAUSAL_GATING_AND_CANDIDATE_MACRO.md)
3. [PHASE_32_ATTRIBUTION_AND_FULL_CHAIN_BACKTEST.md](/Users/aries/Dve/crypto/Stratum/doc/phases/PHASE_32_ATTRIBUTION_AND_FULL_CHAIN_BACKTEST.md)
4. [PHASE_33_POSITION_SIZING_AND_PORTFOLIO_RISK.md](/Users/aries/Dve/crypto/Stratum/doc/phases/PHASE_33_POSITION_SIZING_AND_PORTFOLIO_RISK.md)

配套文档：

- [OPTIMIZATION_PLAN.md](/Users/aries/Dve/crypto/Stratum/doc/OPTIMIZATION_PLAN.md)
- [METRICS_AND_ACCEPTANCE.md](/Users/aries/Dve/crypto/Stratum/doc/METRICS_AND_ACCEPTANCE.md)
- [OBSERVATION_RUNBOOK.md](/Users/aries/Dve/crypto/Stratum/doc/OBSERVATION_RUNBOOK.md)

## 3. 每阶段固定格式

每个阶段文档都包含：

- 目标
- 前置依赖
- 允许修改范围
- 交付物
- 任务清单
- 禁止事项
- 验收标准

## 4. 给 AI 的执行规则

- 只根据当前阶段文档和主文档施工。
- 若当前阶段文档与主文档冲突，以主文档为准，但必须在结果里指出冲突。
- 不得提前实现后续阶段的业务逻辑。
- 若必须创建占位接口，必须保持最小化，不得填充猜测逻辑。
- 所有核心判断逻辑必须带测试。

## 5. 推荐使用方式

推荐每次给 AI 的输入格式：

```text
请只执行 PHASE_0X 文档，不要提前实现后续阶段。
完成后给出：
1. 修改了哪些文件
2. 哪些任务完成
3. 哪些验收标准已满足
4. 哪些地方仍是占位或待后续阶段完成
```

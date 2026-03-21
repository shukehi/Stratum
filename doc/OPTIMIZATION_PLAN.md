# Stratum 优化总方案

## 1. 文档目标

本文档用于把当前项目从“第一性原理导向系统”推进到“第一性原理闭环系统”。

这里的闭环不是指功能更多，而是指系统对每一个交易决定和不交易决定都能回答同一组问题：

1. 谁在推动价格
2. 谁可能被迫交易
3. 为什么这个位置值得参与
4. 为什么现在值得参与
5. 为什么这个风险值得承担
6. 为什么这次应该做，或为什么这次不该做

## 2. 当前判断

当前版本已经具备正确的主链路意识：

- `市场状态 → 参与者压力 → 结构位置 → 风险收益 → 宏观过滤 → 告警`
- `Volume Profile` 已替代滞后趋势指标
- `CVD` 已作为入场确认层
- `LLM` 没有直接下沉到执行决策

但项目仍存在五个结构性偏差：

1. **状态层偏价格化，不够机制化**
   - 当前 `detectMarketRegime()` 主要依赖 ATR、波动和方向一致性。
   - 它更像“价格行为分类器”，还不是“市场驱动机制分类器”。

2. **参与者层不是硬前置约束**
   - 结构层仍然可以在“没有明确 forced flow 来源”的环境里被调用。
   - 这会让系统退回到“先找图形，再决定要不要解释图形”的路径。

3. **宏观层是全局覆盖，而不是机会级过滤**
   - 当前宏观判断更接近“现在 BTC 偏多还是偏空”。
   - 它还没有围绕某个具体 candidate 回答“这个外部叙事是在强化它还是破坏它”。

4. **归因数据不完整**
   - 当前系统能统计扫描次数、候选数、发送数。
   - 但还不能系统性回答“为什么没信号”“为什么被 block”“后来 block 得对不对”。

5. **回测验证的是局部结构 edge，不是完整系统 edge**
   - 这会让结构模块的统计表现看起来好于真实执行表现。

## 3. 优化目标

本轮优化不以“提升胜率”作为直接目标，而以“修正因果链、补全验证闭环”作为直接目标。

如果这一步做对，后续参数优化才有意义。

本轮优化的结果应满足以下条件：

- 状态层能够识别“谁在驱动市场”，而不仅是“价格长什么样”
- 参与者层成为结构层的硬前置约束
- 宏观层只对具体机会做外围校验
- 不交易决定具备结构化 skip reason
- 被 block 的机会被保留为研究样本
- 回测按真实执行顺序重放全链路
- 告警输出从“发现机会”升级为“可执行机会”

## 4. 非目标

本轮优化不包含以下事项：

- 自动下单
- 高频或逐笔撮合
- 多交易所聚合
- UI 仪表盘重构
- 用更多指标替代现有因果链
- 通过调阈值掩盖因果链问题

## 5. 工作流拆分

### Workstream A: 机制驱动的状态层重构

目标：

- 让状态层回答“谁在推动价格”
- 把价格表现和驱动机制分开

主要产出：

- 机制驱动的 `RegimeDecision`
- 明确的 `driverType`
- 更细的 regime/participant 交叉解释

### Workstream B: 因果链硬门槛

目标：

- 让参与者约束在结构层之前生效
- 把“没人会被迫交易”的环境直接拦住

主要产出：

- `isTradableContext()` 或等价门控函数
- 结构层前置 skip reason
- 统一的 skip stage / skip code

### Workstream C: Candidate-aware 宏观过滤

目标：

- 让宏观层不再对所有候选做同一个全局判决
- 让 LLM 只回答“这个叙事对这个机会是强化还是破坏”

主要产出：

- 基于 candidate 的 macro prompt
- 逐 candidate 的 `pass / downgrade / block`
- 更严格的 prompt 信息边界

### Workstream D: 归因与研究样本闭环

目标：

- 把“不交易”和“被 block”都变成可研究样本

主要产出：

- 结构化 scan/skip 数据
- `blocked_by_macro` 候选保留
- 按因果链层级可查询的归因字段

### Workstream E: 全链路回测与复盘

目标：

- 回测真实重放系统决策顺序
- 验证完整系统 edge，而不是局部模块 edge

主要产出：

- 全链路 walk-forward backtest
- 分层统计报表
- 反事实样本分析

### Workstream F: 仓位与组合风险闭环

目标：

- 把风控从“信号筛选”推进到“可执行仓位建议”

主要产出：

- 建议仓位
- 单笔风险金额
- 同向暴露限制
- 组合风险摘要

## 6. 推荐执行顺序

### 第一阶段：修因果链

1. `PHASE_30_MECHANISM_REGIME_REFACTOR`
2. `PHASE_31_CAUSAL_GATING_AND_CANDIDATE_MACRO`

### 第二阶段：补验证闭环

3. `PHASE_32_ATTRIBUTION_AND_FULL_CHAIN_BACKTEST`

### 第三阶段：补执行闭环

4. `PHASE_33_POSITION_SIZING_AND_PORTFOLIO_RISK`

## 7. 风险控制原则

### 7.1 不先调参数

若因果链顺序和样本留存能力未修正，先调 `minStructureScore`、`minimumRiskReward`、`basisDivergenceThreshold` 这类参数没有统计意义。

### 7.2 不扩大 LLM 权限

宏观层可以更贴近 candidate，但不能越过以下边界：

- 不决定入场价
- 不决定止损价
- 不决定仓位大小
- 不重判 regime / participant / structure

### 7.3 不以信号数量增加为优化目标

一个更严格的因果链系统，短期内很可能让信号数下降。只要可解释性和样本质量提高，这就是正确方向。

## 8. 成功标准

本轮优化完成后，应能满足：

1. 任意一个信号都能沿因果链追溯到 `forced flow` 或 `fair value reversion`
2. 任意一个无信号周期都能给出结构化 skip reason
3. 任意一个 `blocked_by_macro` 样本都能被后验复盘
4. 回测统计能够按 `regime / participant / session / confirmation / confluence / macroAction` 分组
5. 告警内容包含建议仓位与风险预算，而不只是方向和区间

## 9. 配套文档

- [METRICS_AND_ACCEPTANCE.md](/Users/aries/Dve/crypto/Stratum/doc/METRICS_AND_ACCEPTANCE.md)
- [OBSERVATION_RUNBOOK.md](/Users/aries/Dve/crypto/Stratum/doc/OBSERVATION_RUNBOOK.md)
- [PHASE_30_MECHANISM_REGIME_REFACTOR.md](/Users/aries/Dve/crypto/Stratum/doc/phases/PHASE_30_MECHANISM_REGIME_REFACTOR.md)
- [PHASE_31_CAUSAL_GATING_AND_CANDIDATE_MACRO.md](/Users/aries/Dve/crypto/Stratum/doc/phases/PHASE_31_CAUSAL_GATING_AND_CANDIDATE_MACRO.md)
- [PHASE_32_ATTRIBUTION_AND_FULL_CHAIN_BACKTEST.md](/Users/aries/Dve/crypto/Stratum/doc/phases/PHASE_32_ATTRIBUTION_AND_FULL_CHAIN_BACKTEST.md)
- [PHASE_33_POSITION_SIZING_AND_PORTFOLIO_RISK.md](/Users/aries/Dve/crypto/Stratum/doc/phases/PHASE_33_POSITION_SIZING_AND_PORTFOLIO_RISK.md)

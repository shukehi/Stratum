# Phase 33: Position Sizing And Portfolio Risk

## 1. 目标

把已有的风险模型从“门槛过滤器”推进到“可执行仓位建议”。

本阶段完成后，系统输出不应只包含：

- 方向
- 入场区间
- 止损
- 止盈

还必须包含：

- 建议仓位大小
- 单笔风险金额
- 组合层同向暴露摘要

## 2. 前置依赖

- `PHASE_32_ATTRIBUTION_AND_FULL_CHAIN_BACKTEST`
- 当前 `PHASE_06_CONSENSUS_AND_RISK`
- 当前 `PHASE_10-B` 仓位追踪

## 3. 允许修改范围

- `src/services/risk/*`
- `src/services/consensus/*`
- `src/services/orchestrator/*`
- `src/services/alerting/*`
- `src/services/positions/*`
- `src/domain/signal/*`
- `src/domain/position/*`
- `src/app/config.ts`
- `src/cli/*`
- `test/unit/risk/*`
- `test/unit/consensus/*`
- `test/unit/alerting/*`
- `test/unit/positions/*`

## 4. 交付物

- 实际接入主链路的 `computePositionSize()`
- 告警中的建议仓位字段
- 组合风险控制字段

## 5. 任务清单

1. 将 `computePositionSize()` 接入 candidate 最终输出链路。
2. 为告警与持久化增加以下字段或等价表达：
   - recommendedPositionSize
   - riskAmount
   - accountRiskPercent
   - sameDirectionExposure
3. 将相关性暴露从“按仓位数限制”升级为“按风险预算限制”或至少支持双重限制。
4. 在已有 open positions 基础上，给出发出新信号后的组合风险摘要。
5. 在告警文案中明确展示：
   - 单笔风险
   - 建议名义仓位
   - 同向已开仓位数或风险占比
6. 若账户规模缺失，系统必须优雅降级：
   - 保留交易机会
   - 但明确标注“无法计算建议仓位”

## 6. 禁止事项

- 不得在没有止损边界的情况下计算仓位
- 不得让仓位建议绕过既有风控门槛
- 不得直接把建议仓位映射为自动执行动作
- 不得把组合风险控制退化为纯提示文案

## 7. 验收标准

- 告警中可见建议仓位和单笔风险。
- 同向已有暴露较高时，新信号会被降级或限制。
- 缺失账户规模时，系统不会报错，但会显示仓位建议不可用。
- 测试覆盖：
  - 正常仓位计算
  - 止损无效时返回不可计算
  - 高暴露环境下限制新信号

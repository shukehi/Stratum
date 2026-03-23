# Review Phase 06: Consensus And Risk

## 1. 复审目标

确认系统按正确顺序组合状态、参与者、结构和风控，且风险是硬门槛。

## 2. 复审范围

- `src/services/consensus/*`
- `src/services/risk/*`
- 对应测试

## 3. 工程复审问题

1. 共识层是否检查 `regimeConfidence`、`participantConfidence`、`structureScore`、`confirmationStatus`、`riskReward`。
2. `Low CVS (<65) / Median CVS (65-85) / High CVS (>85)` 是否配置化。
3. `reasonCodes` 是否正确向 `TradeCandidate` 传播。
4. `confirmationStatus === "pending"` 是否强制输出 `Low CVS (<65)`。
5. `confirmationStatus === "invalidated"` 是否直接丢弃。

## 4. 第一性原理复审问题

1. 顺序是否仍然是 `state -> participants -> structure -> risk`。
2. 是否存在任何地方让结构层绕过前置层。
3. 风控是否真的能阻断信号，而不是仅作说明。
4. 弱参与者但强结构时，是否只降级为 `Low CVS (<65)`，而不是照常放行。
5. 是否只有在入场区域被"确认"后才产生正式信号，而不是触碰即触发。
6. `minimumRiskReward` 是否有胜率推导锚点（见主文档 §15.0），而不是拍脑袋的偏好值。

## 5. 常见失败模式

- 先跑结构再补过滤
- 风控只是日志，不是门槛
- 真空期没有硬跳过
- `structureScore` 没参与过滤
- `confirmationStatus` 没参与过滤，pending 和 confirmed 同等对待
- `minimumRiskReward` 没有胜率推导依据

## 6. 通过标准

- 共识顺序与主文档一致
- 风控是硬门槛
- 跳过和降级逻辑可解释且配置化
- `confirmationStatus` 正确参与过滤

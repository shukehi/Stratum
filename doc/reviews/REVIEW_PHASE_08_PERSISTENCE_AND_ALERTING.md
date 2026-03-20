# Review Phase 08: Persistence And Alerting

## 1. 复审目标

确认上下文、信号和告警分发被完整保存，且不会因发送失败丢失研究样本。

## 2. 复审范围

- `src/db/*`
- `src/repositories/*`
- `src/clients/telegram/*`
- `src/services/alerts/*`
- `src/services/journaling/*`
- 对应测试

## 3. 工程复审问题

1. 表结构是否与主文档一致（含 `spot_perp_basis`、`basis_divergence`、`liquidity_session`、`structure_score`、`confluence_factors_json`、`confirmation_status`）。
2. `reasonCodes`、`alert_status` 等关键字段是否被持久化。
3. 是否先落库，再发送，再更新状态。
4. 发送失败是否只更新状态而不丢失信号。
5. `calibration_reports` 表是否已创建。

## 4. 第一性原理复审问题

1. 是否保留了足够上下文支持事后归因（含基差、时段、confluence、确认状态）。
2. 是否因为工程简化而丢失关键状态、参与者或结构信息。
3. 告警文案是否仍然体现”状态 -> 参与者 -> 结构 -> 风险”的顺序。
4. 告警文案是否包含 confluence 信息和确认状态。

## 5. 常见失败模式

- 先发送再写库
- 不保存 reason codes
- 不保存 market context
- 不保存 confluence factors 或 confirmation status
- 告警只有方向，没有触发依据

## 6. 通过标准

- 数据落库完整（含新增字段）
- 告警失败不会丢样本
- 告警内容保留核心交易逻辑链

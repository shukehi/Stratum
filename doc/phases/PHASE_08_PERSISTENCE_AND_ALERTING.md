# Phase 08: Persistence And Alerting

## 1. 目标

实现 SQLite 持久化和 Telegram 分发，并保证“先落库，再发送，再回写状态”。

## 2. 前置依赖

- `PHASE_01_PROJECT_BOOTSTRAP`
- `PHASE_02_MARKET_DATA_PIPELINE`
- `PHASE_06_CONSENSUS_AND_RISK`
- `PHASE_07_MACRO_OVERLAY`

## 3. 允许修改范围

- `src/db/*`
- `src/repositories/*`
- `src/clients/telegram/*`
- `src/services/alerts/*`
- `src/services/journaling/*`
- `test/unit/alerts/*`
- `test/integration/persistence/*`

## 4. 交付物

- SQLite schema
- repositories
- Telegram client
- alert builder
- signal journal / outcome journal

## 5. 任务清单

1. 定义 SQLite schema。
2. 建立以下表的最小支持：
   - `candles`
   - `funding_rate_points`
   - `open_interest_points`
   - `news_items`
   - `macro_assessments`
   - `market_contexts`（含 `spot_perp_basis`、`basis_divergence`、`liquidity_session`）
   - `signals`（含 `structure_score`、`confluence_factors_json`、`confirmation_status`）
   - `calibration_reports`（用于后续校准工作流）
3. 实现对应 repository。
4. 实现 Telegram client。
5. 实现 alert 文案构造（含 confluence 和 confirmation 状态信息）。
6. 实现告警分发状态回写。

## 6. 禁止事项

- 不实现调度器
- 不实现完整复盘逻辑
- 不把数据库写逻辑散落到无关服务层

## 7. 验收标准

- 数据库 schema 与主文档字段一致。
- 信号在发送前已落库。
- 发送失败时仅更新 `alert_status`、`alert_error` 等字段。
- 告警文案包含状态、参与者、结构、风险和宏观摘要。

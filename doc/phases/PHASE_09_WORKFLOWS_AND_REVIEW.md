# Phase 09: Workflows And Review

## 1. 目标

打通完整工作流，包括分析周期、历史回填、纸面交易复盘、参数校准和端到端日志。

## 2. 前置依赖

- `PHASE_01_PROJECT_BOOTSTRAP`
- `PHASE_02_MARKET_DATA_PIPELINE`
- `PHASE_03_REGIME_ENGINE`
- `PHASE_04_PARTICIPANT_PRESSURE`
- `PHASE_05_STRUCTURE_ENGINE`
- `PHASE_06_CONSENSUS_AND_RISK`
- `PHASE_07_MACRO_OVERLAY`
- `PHASE_08_PERSISTENCE_AND_ALERTING`

## 3. 允许修改范围

- `src/workflows/*`
- `src/app/scheduler.ts`
- `src/index.ts`
- `test/integration/workflows/*`
- `test/fixtures/*`

## 4. 交付物

- `runAnalysisCycle()`
- `runBackfill()`
- `runPaperTradeReview()`
- `runCalibrationReview()`
- 工作流集成测试

## 5. 任务清单

1. 实现主分析周期。
2. 按主文档顺序串联：
   - 拉取市场数据（含现货价格）
   - 识别当前流动性时段
   - 识别状态
   - 识别参与者压力（含现货-永续基差）
   - 识别结构（含复合结构检测和时段修正）
   - 判定入场确认状态
   - 共识与风控
   - 语义过滤
   - 持久化
   - Telegram 分发
   - 回写告警状态
3. 实现历史数据回填。
4. 实现纸面交易结果复盘占位逻辑。
5. 实现参数校准工作流 `runCalibrationReview()`：
   - 触发条件：已关闭信号数量 `>= calibrationMinSampleSize`（默认 `50`）
   - 按 regime / structureScore / 时段 / confluence 维度生成统计
   - 输出 JSON 校准报告，写入 `calibration_reports` 表
   - 通过 Telegram 发送校准摘要
   - 禁止自动修改 `strategyConfig`
   - 样本量不足时只输出"样本不足"状态
6. 增加关键日志。

## 6. 禁止事项

- 不绕过任何前置层
- 不先发告警后写库
- 不在工作流中重新实现业务规则
- 校准工作流不得自动修改配置

## 7. 验收标准

- 单次分析周期可以从拉数到落库完整跑通。
- 主分析周期包含现货价格拉取和流动性时段识别步骤。
- 工作流日志覆盖关键节点。
- 主流程顺序与主文档一致。
- 失败模块能给出清晰日志，不导致整个进程崩溃。
- 校准工作流在样本不足时输出"样本不足"状态而非空报告。

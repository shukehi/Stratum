# Phase 07: Macro Overlay

## 1. 目标

实现新闻与 LLM 的外围语义过滤层，并固定为 `pass / downgrade / block` 协议。

## 2. 前置依赖

- `PHASE_01_PROJECT_BOOTSTRAP`
- `PHASE_06_CONSENSUS_AND_RISK`

## 3. 允许修改范围

- `src/domain/common/*`
- `src/clients/news/*`
- `src/clients/llm/*`
- `src/domain/macro/*`
- `src/services/news-data/*`
- `src/services/macro/*`
- `src/app/config.ts`
- `test/unit/macro/*`
- `test/integration/macro/*`

## 4. 交付物

- `NewsClient`
- `LlmClient`
- `MacroAssessment`
- `MacroOverlayDecision`
- `applyMacroOverlay()`

## 5. 任务清单

1. 实现新闻抓取接口。
2. 实现 LLM 客户端接口。
3. 实现 `MacroAssessmentSchema`。
4. 实现 JSON 校验与重试。
5. 实现 Prompt 构造函数（见主文档 §14.1）：
   - 传入：最近 `maxNewsItemsForPrompt` 条新闻、当前价格、候选方向和等级、`contextReason`
   - 禁止传入：`structureScore`、`stopLoss`/`takeProfit` 具体价格、`participantConfidence`、`confluenceFactors`、原始 K 线或 OI 数据
   - Prompt 必须包含约束指令，告知 LLM 只能输出 pass/downgrade/block，不能建议方向或位置
6. 实现 `applyMacroOverlay()`。
7. 实现 `applyOverlayDecision()` 合并逻辑（见主文档 §14.3）：
   - `downgrade` 降低一级（`high-conviction → standard`，`standard → watch`，`watch → watch`）
   - `block` 的信号仍写入数据库（`alert_status = "blocked_by_macro"`），不发告警
   - `pass` 的信号保持原等级，`catalystSummary` 附加到告警文案
8. 在 `src/domain/common/reason-code.ts` 中补充语义层使用的 `ReasonCode`。
9. 固定输出动作为：
   - `pass`
   - `downgrade`
   - `block`
10. 禁止语义层升级信号等级。

## 6. block / downgrade / pass 判定标准（见主文档 §14.2）

- `block`：未来 `recentEventWatchWindowHours` 内有重大宏观事件、突发监管风险、基本面直接矛盾
- `downgrade`：轻微矛盾、远期利空、过度一致性风险、支撑逻辑减弱
- `pass`：无关或一致新闻、无高影响事件

## 7. 禁止事项

- 不让 LLM 决定方向
- 不让 LLM 决定入场、止损、止盈、仓位
- 不让语义层在共识层之前运行
- 不向 Prompt 传入 `structureScore`、`participantConfidence`、具体止损/止盈价格
- 不向 Prompt 传入原始 K 线或 OI 数据

## 8. 验收标准

- 非法 JSON 有测试。
- 重试逻辑有测试。
- `downgrade` 与 `block` 有测试。
- 语义层只会降级或阻断，不会升级候选。
- Prompt 构造测试：验证禁止传入的字段不在 prompt 中。
- 降级幅度测试：`high-conviction` 被 `downgrade` 后变为 `standard`，`standard` 变为 `watch`。
- `block` 落库测试：被 block 的信号仍写入数据库且 `alert_status = "blocked_by_macro"`。
- `pass` 文案测试：`catalystSummary` 被附加到告警文案。

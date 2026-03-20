# Review Phase 07: Macro Overlay

## 1. 复审目标

确认 LLM 仍然处于外围过滤层，而不是重新进入核心决策路径。

## 2. 复审范围

- `src/clients/news/*`
- `src/clients/llm/*`
- `src/services/news-data/*`
- `src/services/macro/*`
- 对应测试

## 3. 工程复审问题

1. LLM 输出是否严格经过 `zod` 校验。
2. 是否存在重试和失败降级逻辑。
3. `MacroOverlayDecision` 是否固定为 `pass / downgrade / block`。
4. 是否有 `downgrade` 和 `block` 行为测试。
5. Prompt 构造是否遵循 §14.1 规范：禁止传入的字段是否确实未出现在 prompt 中。
6. Prompt 是否包含约束指令（只能 pass/downgrade/block，不能建议方向或位置）。
7. `downgrade` 降级幅度是否为一级（而非直接降到 `watch`）。
8. `block` 的信号是否仍写入数据库（`alert_status = “blocked_by_macro”`）。
9. `pass` 的 `catalystSummary` 是否附加到告警文案。
10. block / downgrade / pass 的判定条件是否与 §14.2 一致，而非由 LLM 自由发挥。

## 4. 第一性原理复审问题

1. 语义层是否只做外围修正。
2. 是否有任何路径让 LLM 决定方向、入场、止损或仓位。
3. 是否允许语义层把低等级信号升级为高等级。
4. 是否有”叙事替代结构”的迹象。
5. LLM 是否被限制在认识论能力范围内——即只做”外部叙事是否破坏前提假设”的判断，而非重新评判结构质量或参与者压力（见 §3A.5）。
6. 传给 LLM 的上下文是否暴露了因果链内部判断（structureScore、participantConfidence），导致 LLM 有机会反过来”评判”因果链。

## 5. 常见失败模式

- LLM 直接输出交易建议
- 语义层升级信号
- 没有 block 机制
- 失败时阻断整个主流程
- Prompt 包含 structureScore 或 participantConfidence，导致 LLM 越权评判因果链内部结果
- downgrade 直接降到最低级而非降一级
- block 的信号被直接丢弃而非写入数据库，导致研究样本丢失
- block / downgrade 边界模糊，完全由 LLM 自由决定而无判定标准

## 6. 通过标准

- LLM 只能降级或阻断
- 语义层不越权
- 无法让新闻叙事替代参与者和结构层
- Prompt 不包含因果链内部判断数据
- 降级幅度正确（一级而非直接最低）
- block 信号不丢失（仍落库）
- 判定标准可追溯（非 LLM 自由发挥）

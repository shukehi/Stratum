# Phase 31: Causal Gating And Candidate Macro

## 1. 目标

把因果链约束前移，并把宏观层改造成机会级外围过滤。

本阶段要完成两件事：

1. 在结构层之前拦住“不具备可交易前提”的上下文
2. 让宏观层回答“这个叙事对这个 candidate 是强化还是破坏”

## 2. 前置依赖

- `PHASE_30_MECHANISM_REGIME_REFACTOR`
- 当前 `PHASE_05_STRUCTURE_ENGINE`
- 当前 `PHASE_07_MACRO_OVERLAY`

## 3. 允许修改范围

- `src/services/orchestrator/*`
- `src/services/participants/*`
- `src/services/structure/*`
- `src/services/macro/*`
- `src/services/consensus/*`
- `src/domain/market/*`
- `src/domain/macro/*`
- `src/domain/common/*`
- `src/app/config.ts`
- `test/unit/orchestrator/*`
- `test/unit/macro/*`
- `test/unit/consensus/*`
- `test/unit/structure/*`

## 4. 交付物

- 因果链前置门控函数
- 结构层前的 skip 决策
- candidate-aware macro prompt
- 逐 candidate 的宏观过滤结果

## 5. 任务清单

1. 实现结构层前置门控逻辑，例如 `isTradableContext()`。
2. 明确以下场景的默认处理：
   - `deleveraging-vacuum` → 直接跳过
   - regime 低置信度 → 直接跳过
   - participant 方向不清晰 → 跳过或仅允许 watch
   - 高波动 / 事件驱动且未开放 → 直接跳过
3. 将 skip 决策集中在结构层之前，而不是把大多数否决留给结构层或共识层。
4. 重构 `buildMacroPrompt()`，输入增加：
   - candidate direction
   - signal grade
   - context reason
   - 允许给 LLM 的最小必要机会摘要
5. 宏观层输出改为逐 candidate 评估，而不是单次扫描一个全局结果覆盖所有候选。
6. 保持 prompt 边界：
   - 不暴露原始 OI/funding 序列
   - 不暴露结构分内部细节
   - 不暴露止损/止盈具体价格
7. 保持 `LLM 只做外围过滤` 的边界不变。

## 6. 禁止事项

- 不得让宏观层重新判断 regime 或 participant pressure
- 不得让结构层在没有通过前置门控的情况下继续执行
- 不得把所有 candidate 继续绑定到同一个宏观裁决
- 不得在 prompt 中暴露因果链内部私有分数

## 7. 验收标准

- 在不可交易 context 下，结构层不应继续运行。
- 同一批新闻下，long candidate 与 short candidate 可以得到不同的 macro action。
- `watch` 级机会不会因为宏观 downgrade 被直接删除。
- bearish 宏观叙事不应自动 block short candidate。
- prompt 测试需证明其包含 candidate 摘要，但不包含内部评分与价格细节。

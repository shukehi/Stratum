# Stratum 阶段复审索引

## 1. 目的

本目录用于在每个开发阶段完成后，对代码进行两类复审：

- 工程复审
- 第一性原理复审

适用对象：

- Codex
- Claude Code
- 其他具备代码审查能力的 AI 助手

## 2. 使用原则

1. 每完成一个阶段，必须执行对应复审文档。
2. 复审未通过，不得进入下一阶段。
3. 复审重点不是“代码能不能跑”，而是“代码是否仍然符合该阶段应承担的系统角色”。
4. 若发现当前阶段越权实现了后续阶段逻辑，应视为缺陷。

## 3. 复审顺序

1. [REVIEW_PHASE_01_PROJECT_BOOTSTRAP.md](/Users/aries/Dve/crypto/Stratum/doc/reviews/REVIEW_PHASE_01_PROJECT_BOOTSTRAP.md)
2. [REVIEW_PHASE_02_MARKET_DATA_PIPELINE.md](/Users/aries/Dve/crypto/Stratum/doc/reviews/REVIEW_PHASE_02_MARKET_DATA_PIPELINE.md)
3. [REVIEW_PHASE_03_REGIME_ENGINE.md](/Users/aries/Dve/crypto/Stratum/doc/reviews/REVIEW_PHASE_03_REGIME_ENGINE.md)
4. [REVIEW_PHASE_04_PARTICIPANT_PRESSURE.md](/Users/aries/Dve/crypto/Stratum/doc/reviews/REVIEW_PHASE_04_PARTICIPANT_PRESSURE.md)
5. [REVIEW_PHASE_05_STRUCTURE_ENGINE.md](/Users/aries/Dve/crypto/Stratum/doc/reviews/REVIEW_PHASE_05_STRUCTURE_ENGINE.md)
6. [REVIEW_PHASE_06_CONSENSUS_AND_RISK.md](/Users/aries/Dve/crypto/Stratum/doc/reviews/REVIEW_PHASE_06_CONSENSUS_AND_RISK.md)
7. [REVIEW_PHASE_07_MACRO_OVERLAY.md](/Users/aries/Dve/crypto/Stratum/doc/reviews/REVIEW_PHASE_07_MACRO_OVERLAY.md)
8. [REVIEW_PHASE_08_PERSISTENCE_AND_ALERTING.md](/Users/aries/Dve/crypto/Stratum/doc/reviews/REVIEW_PHASE_08_PERSISTENCE_AND_ALERTING.md)
9. [REVIEW_PHASE_09_WORKFLOWS_AND_REVIEW.md](/Users/aries/Dve/crypto/Stratum/doc/reviews/REVIEW_PHASE_09_WORKFLOWS_AND_REVIEW.md)

## 4. 推荐给 AI 的复审输入

```text
请只按对应 REVIEW_PHASE 文档复审当前代码。
重点输出：
1. Findings，按严重程度排序
2. 这些问题是否违背第一性原理或系统角色边界
3. 是否允许进入下一阶段
4. 若不允许，最小修复集合是什么
```

## 5. 统一复审输出要求

每次复审至少回答：

1. 当前阶段是否完成了它本该完成的事情
2. 是否越权做了其他阶段的事情
3. 是否存在违反主架构或 AI 实现规格的地方
4. 是否存在偏离交易第一性原理的实现
5. 是否允许进入下一阶段

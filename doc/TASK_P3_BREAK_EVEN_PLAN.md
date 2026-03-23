# TASK_P3: 物理盈亏平衡点火计划 (Project Break-Even)

> "当位移达到 1.0R 时，自动上锁防热盾。消除下行熵，保持全额推力。" —— 马斯克式物理防御准则。

## 1. 第一性原理背景
- **现状**：信号在达到盈利目标中途回撤导致 1.0R 的亏损，造成资本周转效率的净损耗。
- **物理定义**：1.0R 位移标志着信号已脱离"随机噪音区"。
- **目标**：一旦达成 1.0R，强制将风险（Stop Loss）归零。

## 2. 实施规格 (Engineering Spec)

### A. 数据结构扩展
- **Table**: `positions`
- **New Column**: `be_activated` (INTEGER, 默认 0)
- **物理意义**: 记录该推进器是否已进入"无风险轨道"。

### B. 监控逻辑注入 (`monitor-positions.ts`)
- **采样频率**: 30s 轮询。
- **判定公式**: `Unrealized_PnL_R >= 1.0`。
- **动作**: 
    1. 计算 `BE_Price = EntryMid + Friction_Offset` (补偿手续费)。
    2. 执行 `UPDATE positions SET stop_loss = BE_Price, be_activated = 1 WHERE id = ?`。

### C. 统计逻辑对齐
- 平仓结果新增 `closed_be` 状态（归类为 0R 附近的特殊平仓）。

---

## 3. 物理路线图 (Sprint)
- [ ] **Task P3.1**: 数据库架构升级，注入 `be_activated` 列。
- [ ] **Task P3.2**: 重构 `track-position.ts` 增加 BE 激活函数。
- [ ] **Task P3.3**: 在 `monitor-positions.ts` 中点火，实现 1.0R 自动锁死。
- [ ] **Task P3.4**: 物理对齐测试套件。

---
**"Acceleration is survival. Zero risk is the ultimate leverage."**

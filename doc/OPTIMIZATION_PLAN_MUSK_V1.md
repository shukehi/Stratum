# Stratum 2.0 优化方案：回归物理第一性原理 (V3 - Final Spec)

> "最好的零件就是没有零件。最简单的系统就是最不容易崩溃的系统。删除，直到系统无法再精简为止。如果不需要它，就从物理结构和数据结构中彻底抹除它。" —— 伊隆·马斯克终极审计。

---

## 🛑 终极审计裁决 (The Final Verdict)

1. **零熵抹除 (Total Erasure)**：LLM 宏观层不仅要停止调用，还要从代码库、配置项和**数据结构定义**中彻底物理删除。禁止在内存和数据库中为死去的逻辑预留任何空间。
2. **统计力学 (3-Sigma Physics)**：废除死板的“2% 阈值”。物理学不看绝对值。使用 **3 倍标准差 (3-Sigma)** 来识别真正的 OI 坍缩。只有当能量释放超出背景噪音时，才是真实的扫荡。
3. **取消 Grade 标签**：Grade 是社会科学。机器只认 **Expected Velocity (EV)**。停止对信号进行“优良中差”的评价，改为计算资本的瞬时周转期望。
4. **全静默全自动 (Silent FSD)**：让人类看日志是浪费带宽。Telegram 应降级为“故障报警层”。系统正常运行时必须保持死寂，只有在物理参数崩溃（滑点、API 延迟）时才准干预。

---

## 🚀 核心重构任务 (The Directive)

### 1. 零件物理清除：数据结构去熵 (Zero Entropy)
- **操作**：彻底移除 `src/services/macro/` 及 `src/domain/macro/`。
- **数据重构**：从 `TradeCandidate` 和 `OpenPosition` 的 `interface` 中物理删除所有 `macroAssessment`, `macroAction` 等字段。
- **配置清理**：从 `env.ts` 中删除所有 AI/News 相关的环境变量，确保没有任何比特流浪费在无效零件上。

### 2. 动能触发：3-Sigma OI 坍缩检测 (Physics-First)
- **物理公式**：`OI_Crash_Index = (Current_OI_Delta / Rolling_StdDev_of_OI_4h)`。
- **硬触发门槛**：`Math.abs(OI_Crash_Index) > 3.0`。
- **重构方案**：将 `detect-oi-crash.ts` 作为 `StructuralSetup` 的核心验证器。如果没有发生 3 倍标准差以上的持仓异动，任何价格穿刺均为震荡噪音，直接过滤。

### 3. 资本效率：动态资本换仓引擎 (Capital Vacuum)
- **策略**：废除所有静态 `Exposure Limit`（如：同向不超2笔）。
- **算法逻辑**：
    - 将 `Signal_Grade` 替换为 `Capital_Velocity_Score (CVS)`。
    - **自动置换**：如果新信号的 `CVS` 显著高于当前持仓中最弱的头寸，系统必须自动平掉弱项，将资本真空吸入最强的引擎。资本不应该在低效的仓位里腐烂。

### 4. 闭环执行：全静默 FSD (Silent FSD)
- **操作**：彻底移除 Telegram 的 `pending` 确认环节。
- **状态机流转**：`Scan` -> `Physical Confirmation (CVD/OI)` -> `Auto-Open` -> `Telemetry Sync`。
- **报警逻辑**：Telegram 仅在 `System_Error` 或 `Execution_Slippage > Threshold` 时发送通知。如果一切顺利，保持静默。

---

## 📐 工程级细化规格 (Final Engineering Spec)

### Spec 1: 物理清除清单
- **Files**: `rm -rf src/services/macro src/domain/macro test/unit/macro`.
- **Types**: 重写 `src/domain/signal/trade-candidate.ts` 和 `src/domain/position/open-position.ts`。
- **Logic**: 移除 `run-signal-scan.ts` 中所有涉及 Macro 的同步/异步逻辑。

### Spec 2: 3-Sigma 检测器
- **Window**: 最近 50 根 4h K 线。
- **Calculation**: 计算 OI 变动率的滚动平均值和标准差。
- **Trigger**: `(Current_OI_Change - Mean) > 3 * StdDev`。

### Spec 3: 资本置换协议
- **Trigger**: 当新信号出现且 `CVS_new > CVS_old_worst * 1.2`（且账户风险超限时）。
- **Action**: 自动发送 `CLOSE_OLD` 指令并立即执行 `OPEN_NEW`。

### Spec 4: FSD 静默化
- **Default Status**: 告警发送后状态直接设为 `sent`，同步写入 `positions` 表。
- **Log Level**: 全局日志级别设为 `info`，Telegram 仅接收 `warn` 及以上级别（即仅限故障报警）。

---

## 🛠️ 实施路线图 (Zero Compromise Plan)

- [ ] **Task 1: 零熵行动** - 执行物理删除，重构核心数据结构。
- [ ] **Task 2: 3-Sigma 引擎实现** - 开发并注入基于标准差的动态动能检测器。
- [ ] **Task 3: 资本调度器重写** - 实现基于 CVS 的动态换仓逻辑。
- [ ] **Task 4: FSD 全静默化** - 移除所有人工确认逻辑，实现闭环执行。

---
**"Acceleration is the only thing that matters. Do not add. Only delete."**

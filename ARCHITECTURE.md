# Stratum 2.0 架构设计文档：物理动能引擎

> **版本**: v2.0.0 (Musk Physics Refactor)
> **最后更新**: 2026-03-23
> **设计原则**: 统计力学驱动，零熵执行

---

## 一、物理第一性原理：交易的真理

### 市场本质 (The Physics)
市场是一个能量转移系统。价格变动的物理原因只有两个：
1.  **动能失衡**：主动成交量（CVD）的瞬间爆发打破了挂单阻力。
2.  **质量湮灭**：持仓量（OI）的断崖式下跌（强平/止损），导致价格瞬间坍缩。

### 信号的物理定义
一个符合 Stratum 2.0 标准的信号必须通过 **3-Sigma 动能验证**：
- **价格越位** (Position) + **能量爆发** (Energy) = 有效碰撞。
- 没有 OI 坍缩的价格刺穿仅仅是物理噪音。

---

## 二、系统架构：三级物理管道

### 1. 感应层 (Sensing Layer) — 3-Sigma 动能感知
实时监控市场压力的瞬时变化，过滤掉 99.7% 的统计噪音。
- **3-Sigma OI Crash**：计算 OI 变动率的标准差偏离。Index < -3.0 时确认能量释放。
- **CVD 加速度**：监控成交量差的导数，确认真实买卖盘的“推力”。

### 2. 决策层 (Brain Layer) — CVS 期望引擎
废除主观评级，使用连续实数衡量资本的周转潜力。
- **CVS (Capital Velocity Score)**：综合结构评分、对齐度乘数和盈亏比奖励。
- **CSP (Capital Swapping Protocol)**：资本达尔文主义。当新信号 CVS 显著占优时，自动“平旧开新”，实现资本流速最大化。

### 3. 执行层 (Actuator Layer) — FSD 全静默闭环
彻底去碳化，实现亚秒级闭环。
- **Silent FSD**：移除 `pending` 等待态。发现即点火，直接控制交易所 API。
- **故障遥测**：Telegram 降级为静默报警器，仅在物理参数（滑点、API 延迟）崩溃时介入。

---

## 三、系统指标 (Physics Metrics)

| 模块 | 第一性原理准则 | 技术实现 |
|------|-------------|---------|
| 动能验证 | 3-Sigma 异常检测 | `src/services/analysis/detect-oi-crash.ts` |
| 结构确认 | 能量绑定 Sweep | `src/services/structure/detect-liquidity-sweep.ts` |
| 资本调度 | CVS 置换协议 | `src/services/risk/evaluate-exposure-gate.ts` |
| 执行闭环 | FSD 全静默模式 | `src/services/orchestrator/run-signal-scan.ts` |

---

## 四、开发状态 (Milestones)

### ✅ PHASE_V2_PHYSICS — 马斯克重构 (已完成)
- [x] **零熵行动**：彻底物理删除所有 LLM、News 和 Macro 冗余代码及数据结构。
- [x] **动能点火**：实现 3-Sigma OI 坍缩检测，强制绑定 Sweep 逻辑。
- [x] **资本真空**：引入 CVS 评价体系与自动换仓置换协议。
- [x] **全静默驾驶**：移除 Telegram 审批环节，实现 100% 自动模拟执行。

---

## 五、设计约束 (Zero Tolerance)

```
❌ 严禁引入任何基于"叙事"或"情绪分析"的模糊过滤层。
❌ 严禁引入静态的、人为设定的持仓限额（由 CVS 置换自动调节）。
❌ 严禁在扫描路径中引入任何超过 100ms 的外部 API 同步调用。
❌ 严禁依赖碳基生物的实时审批来驱动执行。
```

**"Acceleration is the only thing that matters. The machine must run in the vacuum of pure data. 🚀"**

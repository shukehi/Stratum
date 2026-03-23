# Stratum 2.0 性能指标与验收标准

> "性能不是评估出来的，是计算出来的。衡量系统捕捉能量的效率，而非叙事的准确性。"

## 1. 物理感应指标 (Sensing Metrics)

### 3-Sigma OI 命中率
- **定义**：信号发生时，匹配到 3-Sigma 级别 OI 坍缩的比例。
- **目标**：> 90% 的 Sweep 信号必须具备物理动能。
- **物理意义**：过滤 99.7% 的背景震荡噪音。

### 扫描延迟 (Scan Latency)
- **目标**：从 K 线收盘到 FSD 自动开仓指令发出，耗时 < 500ms。
- **验收点**：彻底移除 LLM 同步调用后的物理提速。

---

## 2. 资本调度指标 (Capital Metrics)

### CVS 质量分布 (CVS Density)
- **定义**：系统生成的信号中，CVS > 80 的高动能信号占比。
- **目标**：通过 3-Sigma 过滤提高平均 CVS 指数。

### CSP 置换效率 (Swapping Velocity)
- **定义**：当新信号 CVS 显著占优时，旧头寸被平仓并成功换仓的成功率。
- **目标**：100% 自动执行，无碳基干预延迟。

---

## 3. 运行可靠性 (Operational Excellence)

### FSD 静默度 (Signal-to-Noise Ratio)
- **目标**：Telegram 仅在 0.1% 的非预期物理异常（API 崩溃、滑点超限）时发送通知。
- **验收**：常规交易全自动静默运行。

---

## 4. 统计力学验收 (Statistical Acceptance)

### 风险修正胜率 (Risk-Adjusted WinRate)
- **验收标准**：在 100 笔 3-Sigma 过滤后的交易样本中，平均盈亏比 (Avg R) > 1.5R。

**"Acceleration is the only metric. Energy is the only truth."**

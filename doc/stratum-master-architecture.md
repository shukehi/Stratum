# Stratum 2.0 主架构文档：物理动能驱动引擎

> "回归交易的物理本质：捕捉能量湮灭，最大化资本流速。" —— 马斯克式第一性原理设计。

## 1. 设计核心 (The Core)

Stratum 2.0 是一个**零熵、静默、全自动**的市场动能捕捉器。它彻底废弃了基于叙事（Physics/News）和几何（Drawings）的传统分析，转而完全依靠**统计力学**和**数学期望**。

### 核心物理准则：
1.  **3-Sigma 验证**：只有当持仓量（OI）坍缩超出背景噪音 3 个标准差时，能量释放才被确认为有效。
2.  **CVS 期望**：使用 Capital Velocity Score 替代主观评级，量化每一比特资本的周转潜力。
3.  **CSP 置换**：资本像真空一样自动流向 EV 最高点，实现仓位的优胜劣汰。
4.  **FSD 闭环**：完全移除碳基生物干预，实现“发现即点火”的零延迟执行。

---

## 2. 系统管道 (The Pipeline)

### 第一阶段：物理感应 (Sensing)
- **数据源**：实时 OHLCV、Open Interest (OI)、Cumulative Volume Delta (CVD)。
- **动能插件**：`detect-oi-crash.ts` 计算 OI 变动率的标准差偏离。
- **结构确认**：`Liquidity Sweep` 必须与 `3-Sigma OI Crash` 强制同步。

### 第二阶段：共识与期望 (Processing)
- **CVS 计算**：`Score = Structure * Alignment * RR_Bonus`。
- **对齐度验证**：Regime（趋势/震荡）与 Participant Pressure（挤压/清算风险）的物理对齐。

### 第三阶段：资本调度 (Dispatching)
- **CSP 协议**：检查账户总风险。
- **自动置换**：若新信号 CVS 优于旧头寸 1.2 倍，自动执行平旧开新。

### 第四阶段：全静默执行 (Actuation)
- **FSD 模式**：直接调用交易所 API，跳过 Telegram 审批。
- **遥测监控**：Telegram 仅作为“灾难报警器”，保持长期死寂。

---

## 3. 核心算法 (The Math)

### OI 坍缩索引 (3-Sigma)
$$Index = \frac{Current\_OI\_Delta - \mu(OI\_Rates)}{\sigma(OI\_Rates)}$$
*触发条件：Index < -3.0*

### 资本周转期望 (CVS)
$$CVS = Base\_Score \times Multiplier_{Alignment} \times Multiplier_{RR}$$

---

## 4. 维护与遥测 (Telemetry)

- **日志级别**：`info` (记录物理轨迹), `warn` (触发 FSD 报警)。
- **分析工具**：`pnpm report` 专注于物理分桶（Regime, OI Crash Index, CVS Distribution）。

**"The machine is silent. The data is physical. The execution is absolute."**

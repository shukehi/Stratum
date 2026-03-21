# Stratum — 开发任务清单

> 按优先级排列。每个PHASE完成后更新状态。
> 详细设计见 [ARCHITECTURE.md](./ARCHITECTURE.md)

---

## ✅ 已完成

| PHASE | 内容 | Commit |
|-------|------|--------|
| PHASE_01~12 | 基础架构、交易所、结构分析、仓位追踪 | — |
| PHASE_13 | 时段监控器 + 心跳通知 | 677a40c |
| PHASE_14 | CLI查询工具（report/positions/backtest） | 206d039 |
| PHASE_15 | K线本地持久化 + 回测离线缓存 | d2ab713 |
| PHASE_16 | 日线趋势过滤（市场结构法，摆高摆低） | 2609c4b |
| PHASE_17 | Volume Profile 替换日线偏向（溢价/均衡/折价，614测试全通过） | 11f3e72 |
| PHASE_18 | CVD 订单流确认层（Kaufman近似，4h信号过滤，636测试全通过） | 7b10346 |

---

### 技术债务

| ID | 内容 | 来源 | 优先级 |
|----|------|------|--------|
| DEBT_01 | CCXT `fetchOHLCV` 可能包含未收盘的当前 K 线，所有 K 线分析（VP/CVD/结构检测）都受影响，需统一在数据获取层过滤 `slice(0, -1)` | Codex adversarial review (PHASE_18 F2) | ⭐⭐ |

---

### PHASE_19 — 等高等低（Equal Highs/Lows）检测
**优先级**: ⭐⭐⭐ | **估时**: CC ~20分钟

**背景**: 普通摆高摆低代表单个止损聚集区。
等高等低（多个K线的高/低点在容差范围内重合）代表止损极度密集的区域，
机构更倾向于优先扫描这些位置。

**交付物**:
- [ ] `src/services/structure/detect-equal-levels.ts`
  - `detectEqualHighs(candles, tolerance?, minCount?)` → EqualLevel[]
  - `detectEqualLows(candles, tolerance?, minCount?)` → EqualLevel[]
  - tolerance默认0.1%（价格容差），minCount默认2
- [ ] 将等高等低识别结果集成到 `StructuralSetup`
- [ ] 等高等低作为更高优先级的流动性目标（优于普通摆高摆低）
- [ ] 单元测试：识别准确率、容差边界
- [ ] 更新 `ARCHITECTURE.md` PHASE_19完成状态

---

### PHASE_20 — 平仓热力图集成
**优先级**: ⭐⭐⭐ | **估时**: CC ~45分钟

**背景**: 平仓热力图显示哪些价位有大量杠杆仓位将被强制平仓。
这是价格"磁力区"的真实来源，比技术分析更直接。

**数据来源**: Coinglass Open API

**交付物**:
- [ ] `src/clients/coinglass/coinglass-client.ts` — API客户端
- [ ] `src/services/analysis/liquidation-map.ts` — 热力图分析
  - `fetchLiquidationMap(symbol)` → LiquidationLevel[]
  - `findNearestLiquidationZone(price, levels, direction)` → 最近平仓区
- [ ] 将平仓热力图用于止盈目标价优化（`takeProfitHint`）
- [ ] 环境变量: `COINGLASS_API_KEY`
- [ ] 单元测试（mock API响应）
- [ ] 更新 `COMMANDS.md`、`ARCHITECTURE.md`

---

### PHASE_21 — 事件驱动架构（长期）
**优先级**: ⭐⭐ | **估时**: CC ~3小时

**背景**: 当前4h定时扫描在价格触达关键位时存在最长4小时延迟。
事件驱动架构在价格触达预设关键位时立即触发深度分析，
消除延迟并大幅减少无效扫描。

**前置条件**: PHASE_17完成（需要VP关键位定义）✅

**交付物**:
- [ ] `src/services/scheduler/price-watcher.ts` — 价格监听器
  - 轮询间隔: 30秒（现有position monitor复用）
  - 触发条件: 价格进入VPOC±0.5% / VAH / VAL / 流动性区
- [ ] `src/services/orchestrator/run-event-scan.ts` — 事件触发扫描
- [ ] 与现有4h定时扫描并行运行（逐步替换）
- [ ] 防止同一区间重复触发（冷却期机制）

---

## 🚫 不做清单

> 经过第一性原理分析，以下方向不符合系统设计哲学，不予实现。

| 功能 | 原因 |
|------|------|
| 15分钟K线信号 | 时间框架叠加，边际价值低；入场精化应用CVD替代 |
| 周线K线信号 | 用Volume Profile溢价/折价替代；更准确 |
| RSI / MACD / 布林带 | 价格的数学变换，无因果机理 |
| K线形态识别（锤子线等） | 统计相关，无机构行为解释 |
| ML价格方向预测 | 过拟合风险高，市场机制变化无法适应 |
| 多交易对相关性矩阵 | 已有 `maxCorrelatedSignalsPerDirection` 限制 |

---

*更新规则：每个PHASE开始前将对应任务移至"进行中"，完成后移至"已完成"并记录commit。*

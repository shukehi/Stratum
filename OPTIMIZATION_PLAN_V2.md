# Stratum V2 优化计划 — 第一性原理物理审计修复清单

> **版本**: v2.0  
> **制定日期**: 2026-03-24  
> **前置文档**: [第一性原理审计报告](first_principles_analysis.md) (审计评分: 78/100)  
> **目标评分**: 92/100  
> **基础原则**: 修复审计中发现的 4 个物理短路 + 3 个精度缺陷 + 1 个架构风险  
> **执行顺序**: P0 → P1 → P2 → P3（严格按优先级，不跨级并行）

---

## 核心诊断回顾

审计发现的物理方程缺陷：

```
EV = P(Win) × Gain − P(Loss) × Loss > 0
```

| 缺陷层 | 问题 | 影响 | 优先级 |
|--------|------|------|--------|
| 感应层 | FVG 信号绕过 OI 物理门控 | ~40% 的 FVG 信号可能是纯噪音 | P0 |
| 执行层 | V1 调度器与 WebSocket 扫描竞态 | 可能重复开仓/重复通知 | P0 |
| 数据层 | 模拟/实盘仓位无隔离 | 模式切换时数据冲突 | P0 |
| 决策层 | CVD 惩罚、半衰期使用离散常量 | EV 估计偏差 5-15% | P1 |
| 决策层 | Sweep 深度评分区间边界硬编码 | 极端市场评分偏离 10-15 分 | P1 |
| 风控层 | 单品种集中度无限制 | 极端行情下的灾难性风险 | P2 |
| 决策层 | CVS 摩擦力缺少市场冲击成本 | 大仓位的真实 EV 被高估 | P3 |

---

## P0 优先级任务（立即执行，影响系统物理一致性）

### TASK-V2-P0-A：FVG 信号接入 OI 物理门控

**目标文件**: `src/services/structure/detect-fvg.ts`  
**涉及文件**: `src/services/structure/detect-structural-setups.ts`, `src/app/config.ts`  
**预计工时**: 3h  
**验收方式**: 无 OI 坍缩时 FVG 信号返回空数组

#### 物理问题

ARCHITECTURE.md 声明的核心原则：

> "没有 OI 坍缩的价格刺穿仅仅是物理噪音。"

但当前代码中，FVG 信号完全绕过了这一门控：

```typescript
// detect-structural-setups.ts L74-78 — 当前代码
const fvgSetups = detectFvg(candles4h, "4h", config);          // ← 无 OI 门控！
const sweepSetups = detectLiquiditySweep(candles4h, config, oiPoints); // ← 有 OI 门控
const combined = [...fvgSetups, ...sweepSetups];
```

FVG（公允价值缺口）代表的是"价格快速移动时未被成交的区域"。但**为什么价格快速移动？** 如果没有 OI 的剧烈变化（即没有大规模清算/强平），价格的快速移动可能只是流动性真空时段的随机波动（如亚洲盘尾的薄盘穿刺），而非真正的能量事件。

#### 修改方案

**策略选择**：不要求 FVG 必须通过 3-Sigma OI 坍缩门控（这太严格，会过滤掉大量有效 FVG），而是引入 **OI 活跃度评分**——当 OI 变动率处于 1-Sigma 以上时，FVG 信号获得加分，反之获得惩罚。

**Step 1**: `config.ts` 新增 FVG 物理门控配置

```typescript
// StrategyConfig 新增字段（--- FVG 物理门控 ---）
readonly fvgRequireOiActivity: boolean;       // 是否要求 FVG 有 OI 活跃度（默认 true）
readonly fvgOiActivitySigmaThreshold: number; // FVG OI 活跃度门槛 σ（默认 1.0，比 Sweep 宽松）
readonly fvgOiInactivityPenalty: number;       // OI 不活跃时的评分惩罚（默认 -15）
readonly fvgOiActivityBonus: number;          // OI 活跃时的评分加成（默认 +8）

// strategyConfig 默认值
fvgRequireOiActivity: true,
fvgOiActivitySigmaThreshold: 1.0,
fvgOiInactivityPenalty: -15,
fvgOiActivityBonus: 8,
```

**Step 2**: `detect-fvg.ts` 修改签名，接受 OI 数据

```typescript
import { detectOiCrash } from "../analysis/detect-oi-crash.js";
import type { OpenInterestPoint } from "../../domain/market/open-interest.js";

export function detectFvg(
  candles: Candle[],
  timeframe: "4h" | "1h",
  config: StrategyConfig,
  scanWindow = 30,
  oiPoints: OpenInterestPoint[] = [],  // ← 新增
): StructuralSetup[] {
  const recent = candles.slice(-scanWindow);
  if (recent.length < 3) return [];

  // OI 活跃度评估（使用 1-Sigma 阈值，比 Sweep 宽松）
  let oiActivityBonus = 0;
  if (config.fvgRequireOiActivity && oiPoints.length >= 10) {
    const closePrices = candles.map(c => c.close);
    const oiResult = detectOiCrash(oiPoints, closePrices, 50, config.fvgOiActivitySigmaThreshold);
    
    if (oiResult.isCrash) {
      // OI 发生了 1-Sigma 级别的变化 → FVG 有能量支撑
      oiActivityBonus = config.fvgOiActivityBonus;
    } else if (Math.abs(oiResult.crashIndex) < 0.5) {
      // OI 几乎没有变化（< 0.5-Sigma）→ FVG 可能是流动性真空噪音
      oiActivityBonus = config.fvgOiInactivityPenalty;
    }
    // 0.5 ~ 1.0-Sigma 之间不加不减（中性）
  }

  // ... 在每个 FVG 的 structureScore 计算中加入 oiActivityBonus：
  // 原始：const structureScore = clamp(Math.round(55 + gapRatio * 30), 0, 100);
  // 修改：const structureScore = clamp(Math.round(55 + gapRatio * 30 + oiActivityBonus), 0, 100);
}
```

**Step 3**: `detect-structural-setups.ts` 透传 OI 数据给 FVG

> **注意**：`detectFvg` 调用实际位于文件 L77（注释在 L74），以代码内容为准。  
> 新增的 `oiPoints` 参数有默认值 `[]`，现有调用方无需修改。

```typescript
// 原代码 L77（实际行号）：
const fvgSetups = detectFvg(candles4h, "4h", config);

// 新代码：
const fvgSetups = detectFvg(candles4h, "4h", config, 30, oiPoints);
```

#### 验收标准

- [ ] `oiPoints` 为空时，FVG 行为与修改前完全一致（`oiActivityBonus = 0`）
- [ ] `fvgRequireOiActivity = false` 时，FVG 行为与修改前完全一致
- [ ] OI 变化率 < 0.5-Sigma 时，FVG 评分降低 15 分
- [ ] OI 变化率 > 1-Sigma 时，FVG 评分提升 8 分
- [ ] 新增单元测试：覆盖 OI 活跃/不活跃/无数据三种场景
- [ ] `tsc --noEmit` 零错误

---

### TASK-V2-P0-B：扫描互斥锁（竞态消除）

**目标文件**: `src/index.ts`  
**预计工时**: 1h  
**验收方式**: WebSocket 触发与 4h 定时器不会同时执行 `runSignalScan`

#### 物理问题

当前系统有两条路径可以触发 `runSignalScan`：
1. V1 调度器（4h UTC 对齐轮询）— L179-192
2. WebSocket OI 事件驱动 — L198-219

```typescript
// 路径 1（4h 轮询）
const signalScheduler = runScheduler(async () => {
  const result = await runSignalScan(perpSymbol, env.SPOT_SYMBOL, scanDeps);
  // ...
}, { intervalMs: 4h, ... });

// 路径 2（WebSocket 事件驱动）
wsClient.subscribeOi(async (payload) => {
  if (isAlert) {
    const result = await runSignalScan(perpSymbol, env.SPOT_SYMBOL, scanDeps);  // ← 竞态！
  }
});
```

`runSignalScan` 不是幂等的——它会写入数据库（`INSERT OR REPLACE`）、发送通知、开模拟仓位。如果两条路径在窄时间窗内同时触发，可能导致：
- 相同信号重复开仓
- 重复发送通知
- 数据库竞写

#### 修改方案

在 `index.ts` 中增加原子互斥标记：

> **修正（勘误 #3）**：`exclusiveScan` 使用 `Promise<void>` 返回类型，避免引入未导入的 `SignalScanResult` 类型。`lastScanAt` 通过闭包在函数内部直接赋值。

```typescript
// index.ts — 在 main() 函数内，scanDeps 定义之后

let isScanning = false;

// 包装扫描函数，确保互斥（返回 void，lastScanAt 在闭包内赋值）
async function exclusiveScan(trigger: string): Promise<void> {
  if (isScanning) {
    logger.warn({ trigger }, "Scan 互斥锁生效：跳过本次扫描（上一次扫描仍在进行中）");
    return;
  }
  isScanning = true;
  try {
    logger.info({ trigger }, "Scan 开始执行");
    const result = await runSignalScan(perpSymbol, env.SPOT_SYMBOL, scanDeps);
    lastScanAt = result.scannedAt;  // lastScanAt 在 main() 闭包中可直接访问
  } finally {
    isScanning = false;
  }
}

// 路径 1：4h 轮询 — 替换原有 scanFn
const signalScheduler = runScheduler(
  async () => {
    await exclusiveScan("4h-scheduler");
  },
  { intervalMs: 4 * 60 * 60 * 1000, bufferMs: 30_000, alignToInterval: true, immediate: true },
  shutdownController.signal
);

// 路径 2：WebSocket — 替换原有回调
wsClient.subscribeOi(async (payload) => {
  oiPointsWindow.push({ timestamp: payload.timestamp, openInterest: payload.openInterest });
  if (oiPointsWindow.length > 50) oiPointsWindow.shift();
  
  if (oiPointsWindow.length === 50) {
    const isAlert = detectOiAlert(oiPointsWindow);
    if (isAlert) {
      logger.info("WebSocket: 【事件驱动触发】捕获到 2-Sigma OI 崩溃");
      oiPointsWindow = oiPointsWindow.slice(25);
      try {
        await exclusiveScan("ws-oi-event");
      } catch(err) {
        logger.error({ err }, "WebSocket 事件驱动扫描异常");
      }
    }
  }
}, shutdownController.signal);
```

> **设计说明**：使用 `isScanning` 布尔标记而非 `Mutex` 锁，因为 Node.js 是单线程的，不存在真正的并发。我们需要防止的是 **async 重入**（即前一个扫描的 await 尚未完成时，下一个定时器回调已经触发）。布尔标记在单线程 event loop 中足以解决此问题。

#### 验收标准

- [ ] WebSocket 触发扫描时，如果 4h 定时器同时到期，日志输出"互斥锁生效"
- [ ] `isScanning` 在扫描完成后一定会被重置（`finally` 块保证）
- [ ] 4h 定时器正常触发不受影响
- [ ] WebSocket 事件驱动正常触发不受影响

---

### TASK-V2-P0-C：模拟/实盘仓位数据隔离

**目标文件**: `src/services/positions/track-position.ts`  
**涉及文件**: `src/services/persistence/init-db.ts`, `src/domain/position/open-position.ts`, `src/services/paper-trading/monitor-positions.ts`  
**预计工时**: 2.5h  
**验收方式**: 模拟仓位和实盘仓位互不可见

#### 物理问题

`OpenPosition` 和 `positions` 表没有 `execution_mode` 字段。当用户从 `paper` 切换到 `live` 模式时：
- `getOpenPositions()` 会返回所有模拟仓位
- CSP 置换逻辑会把模拟仓位和实盘仓位混合比较
- `monitorPositions()` 会尝试用实时价格触发模拟仓位的 TP/SL

这就像在模拟飞行训练器中的飞行数据被发送到了真正的空管系统。

#### 修改方案

> **修正（勘误 #4）**：`positions` 表由 `init-positions-db.ts` 管理，**不是 `init-db.ts`**。迁移代码必须写在 `init-positions-db.ts`，照搬现有 `exchange_order_id` 迁移模式。  
> **修正（勘误 #5）**：`executionMode` 通过显式参数注入，不在函数内部读取 `env`，以保持单元测试隔离性。

**Step 1**: `src/services/positions/init-positions-db.ts` — 数据库迁移

在现有 `CREATE TABLE` 语句中追加 `execution_mode` 列（新建数据库路径）：

```sql
-- CREATE TABLE positions 语句中追加（紧跟 exchange_order_id 之后）
execution_mode  TEXT NOT NULL DEFAULT 'paper'
```

并在 `exchange_order_id` 迁移的 `try/catch` 块之后，追加同格式的迁移（存量数据库路径）：

```typescript
// init-positions-db.ts — 照搬 L35-38 的已有迁移模式
try {
  db.prepare("ALTER TABLE positions ADD COLUMN execution_mode TEXT DEFAULT 'paper'").run();
} catch (e) {
  // column already exists — idempotent
}
```

> ⚠️ `init-db.ts` **无需改动**，它不管理 `positions` 表。

**Step 2**: `src/domain/position/open-position.ts` — 类型扩展

```typescript
export type ExecutionMode = "paper" | "live";

export type OpenPosition = {
  // ... 现有字段（不改动）...
  executionMode: ExecutionMode;  // 新增：标记仓位来源
};
```

**Step 3**: `src/services/positions/track-position.ts` — 显式参数注入（不读 `env`）

```typescript
// openPosition：新增 executionMode 可选参数
export function openPosition(
  db: Database.Database,
  candidate: TradeCandidate,
  openedAt: number,
  options: {
    recommendedPositionSize?: number;
    recommendedBaseSize?: number;
    riskAmount?: number;
    accountRiskPercent?: number;
    exchangeOrderId?: string;
    executionMode?: "paper" | "live";  // ← 新增，默认 paper
  } = {}
): void {
  const id = buildId(candidate.symbol, candidate.direction, candidate.timeframe, candidate.entryHigh);
  const executionMode = options.executionMode ?? "paper";
  const now = Date.now();

  db.prepare(`
    INSERT OR REPLACE INTO positions (
      id, symbol, direction, timeframe,
      entry_low, entry_high, stop_loss, take_profit, risk_reward,
      capital_velocity_score, opened_at, status, be_activated, updated_at,
      recommended_position_size, recommended_base_size, risk_amount, account_risk_percent,
      exchange_order_id, execution_mode
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, 'open', 0, ?,
      ?, ?, ?, ?,
      ?, ?
    )
  `).run(
    id, candidate.symbol, candidate.direction, candidate.timeframe,
    candidate.entryLow, candidate.entryHigh, candidate.stopLoss, candidate.takeProfit, candidate.riskReward,
    candidate.capitalVelocityScore, openedAt, now,
    options.recommendedPositionSize ?? null,
    options.recommendedBaseSize ?? null,
    options.riskAmount ?? null,
    options.accountRiskPercent ?? null,
    options.exchangeOrderId ?? null,
    executionMode
  );
}

// getOpenPositions：新增 executionMode 参数（默认 paper，向后兼容）
export function getOpenPositions(
  db: Database.Database,
  executionMode: "paper" | "live" = "paper"
): OpenPosition[] {
  const rows = db.prepare(
    "SELECT * FROM positions WHERE status = 'open' AND execution_mode = ?"
  ).all(executionMode) as any[];
  return rows.map(mapRowToOpenPosition);
}

// getOpenRiskSummary 同步新增 executionMode 参数
export function getOpenRiskSummary(
  db: Database.Database,
  direction?: "long" | "short",
  executionMode: "paper" | "live" = "paper"
) {
  const modeFilter = "AND execution_mode = ?";
  const query = direction
    ? `SELECT COUNT(*) as count, SUM(account_risk_percent) as risk FROM positions WHERE status = 'open' AND direction = ? ${modeFilter}`
    : `SELECT COUNT(*) as count, SUM(account_risk_percent) as risk FROM positions WHERE status = 'open' ${modeFilter}`;

  const row = (direction
    ? db.prepare(query).get(direction, executionMode)
    : db.prepare(query).get(executionMode)) as { count: number; risk: number | null };
  return { openCount: row.count, openRiskPercent: row.risk || 0 };
}
```

**Step 4**: `mapRowToOpenPosition` 追加映射

```typescript
function mapRowToOpenPosition(row: any): OpenPosition {
  return {
    // ... 现有映射（不改动）...
    executionMode: (row.execution_mode ?? "paper") as ExecutionMode,
  };
}
```

**Step 5**: 调用侧更新 — 传入 `env.EXECUTION_MODE`

```typescript
// run-signal-scan.ts — openPosition 调用处
openPosition(db, candidate, scannedAt, {
  recommendedPositionSize: positionSizing.recommendedPositionSize,
  recommendedBaseSize:     positionSizing.recommendedBaseSize,
  riskAmount:              positionSizing.riskAmount,
  accountRiskPercent:      positionSizing.accountRiskPercent,
  exchangeOrderId,
  executionMode: env.EXECUTION_MODE,  // ← 新增
});

// run-signal-scan.ts — getOpenPositions 和 getOpenRiskSummary 调用处
const openPositions   = getOpenPositions(db, env.EXECUTION_MODE);
const portfolioExposure = getOpenRiskSummary(db, undefined, env.EXECUTION_MODE);

// monitor-positions.ts — getOpenPositions 调用处
const openPositions = getOpenPositions(db, env.EXECUTION_MODE).filter(p => p.symbol === symbol);
```

> **单元测试无需修改**：`track-position.test.ts` 直接调用 `openPosition(db, ...)` 和 `getOpenPositions(db)` 不传 `executionMode`，默认值 `"paper"` 使行为与修改前完全一致。

#### 验收标准

- [ ] `EXECUTION_MODE=paper` 时，`getOpenPositions(db, "paper")` 不返回 `live` 仓位
- [ ] `EXECUTION_MODE=live` 时，`getOpenPositions(db, "live")` 不返回 `paper` 仓位
- [ ] 数据库迁移是幂等的（重复执行不报错）
- [ ] 新建数据库时 `positions` 表自带 `execution_mode` 列，默认值为 `'paper'`
- [ ] 现有单元测试（`track-position.test.ts`）全部通过，无需修改
- [ ] `tsc --noEmit` 零错误

---

## P1 优先级任务（短期执行，影响信号精度上限）

### TASK-V2-P1-A：CVD 惩罚连续化

**目标文件**: `src/services/structure/detect-liquidity-sweep.ts`  
**涉及文件**: `src/services/analysis/compute-cvd.ts`  
**预计工时**: 1.5h  
**验收方式**: CVD 强烈反向时惩罚远大于轻微反向

#### 物理问题

当前 CVD 惩罚是离散的硬编码：

```typescript
// detect-liquidity-sweep.ts L138-139 — 当前代码
const cvdBonus = cvdAcc.direction === "bullish" ? 5
               : cvdAcc.direction === "bearish" ? -10 : 0;
```

物理真相：`cvdSlope = -0.04`（轻微反向）和 `cvdSlope = -0.25`（强烈反向）的惩罚不应相同。惩罚幅度应该是 CVD 斜率的**连续函数**。

#### 修改方案

在 `detect-liquidity-sweep.ts` 中新增连续化评分函数，替代离散逻辑：

```typescript
/**
 * CVD 方向对齐评分（连续函数）
 *
 * 物理含义：
 *   CVD 斜率代表主动力量的方向和强度。
 *   斜率与 Sweep 方向一致 → 加分（主动力量确认）
 *   斜率与 Sweep 方向背离 → 减分（主动力量反对）
 *   幅度越大，评分影响越大（连续响应）
 *
 * @param cvdSlope       CVD 加速度斜率（正=bullish，负=bearish）
 * @param sweepDirection Sweep 方向（"long"=看涨, "short"=看跌）
 * @returns              评分调整值（正=加分，负=减分），范围约 [-25, +10]
 */
function computeCvdAlignmentScore(
  cvdSlope: number,
  sweepDirection: "long" | "short"
): number {
  // 对齐系数：slope 方向与 sweep 方向一致时为正，反之为负
  const alignmentSign = sweepDirection === "long" ? 1 : -1;
  const effectiveSlope = cvdSlope * alignmentSign;
  
  // 对齐时：线性加分，上限 +10
  // effectiveSlope > 0 → 方向一致
  // effectiveSlope 0.03 → +3, 0.06 → +6, 0.10+ → +10
  if (effectiveSlope > 0) {
    return Math.min(10, Math.round(effectiveSlope * 100));
  }
  
  // 反向时：二次方惩罚，下限 -25
  // effectiveSlope < 0 → 方向背离
  // effectiveSlope -0.03 → -1, -0.10 → -10, -0.20 → -25
  // 使用 x² 曲线使轻微反向惩罚小、强烈反向惩罚大
  const absSlope = Math.abs(effectiveSlope);
  const penalty = Math.min(25, Math.round(absSlope * absSlope * 625));
  return -penalty;
}
```

替换原有离散逻辑：

```typescript
// 原代码（看涨 Sweep L138-139）：
// const cvdBonus = cvdAcc.direction === "bullish" ? 5 : cvdAcc.direction === "bearish" ? -10 : 0;

// 新代码：
const cvdBonus = computeCvdAlignmentScore(cvdAcc.cvdSlope, "long");

// 原代码（看跌 Sweep L181-182）：
// const cvdBonus = cvdAcc.direction === "bearish" ? 5 : cvdAcc.direction === "bullish" ? -10 : 0;

// 新代码：
const cvdBonus = computeCvdAlignmentScore(cvdAcc.cvdSlope, "short");
```

#### 验收标准

- [ ] `cvdSlope = 0.0` 时，`cvdBonus = 0`（中性，与旧行为一致）
- [ ] `cvdSlope = +0.05`（看涨），对看涨 Sweep：`cvdBonus = +5`（对齐）
- [ ] `cvdSlope = -0.05`（看跌），对看涨 Sweep：`cvdBonus ≈ -2`（轻微反向，轻惩罚）
- [ ] `cvdSlope = -0.20`（强烈看跌），对看涨 Sweep：`cvdBonus ≈ -25`（强反向，重惩罚）
- [ ] 新增单元测试：`computeCvdAlignmentScore` 在各斜率下的输出值符合预期

---

### TASK-V2-P1-B：信号半衰期市场状态自适应

**目标文件**: `src/services/consensus/evaluate-consensus.ts`  
**涉及文件**: `src/app/config.ts`, `src/services/risk/evaluate-exposure-gate.ts`  
**预计工时**: 1.5h  
**验收方式**: 趋势市半衰期 > 高波动市半衰期

#### 物理问题

```typescript
// 当前代码 — 半衰期固定 2h
export function applySignalDecay(cvs: number, signalAgeMs: number, halfLifeMs = 2 * 3_600_000): number
```

物理真相：
- **趋势市**：趋势有惯性，结构信号的有效期更长 → 半衰期应 3-4h
- **震荡市**：价格在区间内来回，中等衰减 → 半衰期 2h（当前值）
- **高波动市**：结构被快速重新定价 → 半衰期应 1-1.5h
- **事件驱动市**：信号几乎立即过期 → 半衰期应 30min

#### 修改方案

**Step 1**: `config.ts` 新增分状态半衰期

```typescript
// StrategyConfig 新增（--- 信号衰减参数 ---）
readonly signalHalfLifeTrendMs: number;         // 趋势市半衰期（默认 4h）
readonly signalHalfLifeRangeMs: number;          // 震荡市半衰期（默认 2h）
readonly signalHalfLifeHighVolMs: number;        // 高波动市半衰期（默认 1.5h）
readonly signalHalfLifeEventMs: number;          // 事件驱动市半衰期（默认 30min）

// strategyConfig 默认值
signalHalfLifeTrendMs: 4 * 3_600_000,      // 4h
signalHalfLifeRangeMs: 2 * 3_600_000,      // 2h
signalHalfLifeHighVolMs: 1.5 * 3_600_000,  // 1.5h
signalHalfLifeEventMs: 30 * 60_000,        // 30min
```

**Step 2**: `evaluate-consensus.ts` 新增 regime 感知的半衰期查表

> **注意（勘误 #7）**：`MarketRegime` 已在 `evaluate-consensus.ts` L3 导入，**无需新增 import**，直接定义函数即可。

```typescript
// import type { MarketRegime } 已在文件顶部 L3 存在，无需重复

/**
 * 根据市场状态获取动态半衰期
 */
export function getRegimeHalfLife(
  regime: MarketRegime | undefined,
  config: StrategyConfig
): number {
  return {
    "trend":          config.signalHalfLifeTrendMs,
    "range":          config.signalHalfLifeRangeMs,
    "high-volatility": config.signalHalfLifeHighVolMs,
    "event-driven":   config.signalHalfLifeEventMs,
  }[regime ?? "range"] ?? config.signalHalfLifeRangeMs;
}
```

**Step 3**: `evaluate-exposure-gate.ts` 使用动态半衰期

```typescript
// 原代码 L86：
const decayedPositionCvs = applySignalDecay(weakestPosition.capitalVelocityScore, positionAge);

// 新代码：
const dynamicHalfLife = getRegimeHalfLife(currentRegime, config);
const decayedPositionCvs = applySignalDecay(weakestPosition.capitalVelocityScore, positionAge, dynamicHalfLife);
```

> **新增 import**: `evaluate-exposure-gate.ts` 顶部追加  
> `import { applySignalDecay, getRegimeHalfLife } from "../consensus/evaluate-consensus.js";`

#### 验收标准

- [ ] `regime = "trend"` 时，信号 2h 后衰减至 70.7%（而非 50%）
- [ ] `regime = "event-driven"` 时，信号 30min 后衰减至 50%
- [ ] `regime` 未传入时，使用 `range` 的默认半衰期（向后兼容）
- [ ] 新增单元测试：覆盖 4 种 regime 下的半衰期查表

---

### TASK-V2-P1-C：Sweep 深度评分区间自适应

**目标文件**: `src/services/structure/detect-liquidity-sweep.ts`  
**涉及文件**: `src/app/config.ts`  
**预计工时**: 2h  
**验收方式**: 趋势市中的最优区间上界 > 震荡市中的上界

#### 物理问题

```typescript
// 当前 scoreSweepDepth() — 硬编码区间边界
if (sweepRatio < 0.3) return 40;
if (sweepRatio <= 0.5) ...    // 爬坡
if (sweepRatio <= 1.5) ...    // 最优区间
if (sweepRatio <= 2.5) ...    // 衰减
return Math.max(20, ...);     // 危险区
```

趋势市中，价格的单方向位移更大，`sweepRatio = 2.0` 可能只是趋势延伸的正常深度。但在震荡市中，`sweepRatio = 1.5` 就可能已经是结构翻转。

#### 修改方案

**Step 1**: `config.ts` 新增分状态的 Sweep 深度最优区间上界

```typescript
// StrategyConfig 新增（--- Sweep 深度区间 ---）
readonly sweepOptimalUpperTrend: number;     // 趋势市最优区间上界（默认 2.0）
readonly sweepOptimalUpperRange: number;     // 震荡市最优区间上界（默认 1.5）— 当前硬编码值
readonly sweepOptimalUpperHighVol: number;   // 高波动市最优区间上界（默认 1.2）
readonly sweepDangerMultiplier: number;      // 危险区起始 = 最优上界 × 此倍数（默认 1.67）

// strategyConfig 默认值
sweepOptimalUpperTrend: 2.0,
sweepOptimalUpperRange: 1.5,
sweepOptimalUpperHighVol: 1.2,
sweepDangerMultiplier: 1.67,
```

**Step 2**: 重构 `scoreSweepDepth()` 为接受动态参数

```typescript
/**
 * Sweep 深度非线性评分（倒 U 型曲线 — 自适应版）
 *
 * @param sweepRatio    刺穿深度 / ATR
 * @param optimalUpper  最优区间上界（由 regime 决定，默认 1.5）
 *
 * 注意：optimalUpper 必须 > 0.5，否则最优区间退化。
 * 实际配置最小值为 sweepOptimalUpperHighVol = 1.2，生产环境不会触发除零，
 * 但加入防御检查以保证单元测试极端输入安全。
 */
export function scoreSweepDepth(sweepRatio: number, optimalUpper = 1.5): number {
  const dangerStart = optimalUpper * 1.67;  // 危险区起始

  if (sweepRatio < 0.3) return 40;           // 深度不足
  if (sweepRatio <= 0.5) {                   // 爬坡段（40→80）
    return 40 + ((sweepRatio - 0.3) / 0.2) * 40;
  }
  if (sweepRatio <= optimalUpper) {           // 最优区间（80→100）
    const span = optimalUpper - 0.5;
    if (span <= 0) return 80;                 // 防御性：区间退化时返回基础分
    return 80 + ((sweepRatio - 0.5) / span) * 20;
  }
  if (sweepRatio <= dangerStart) {            // 衰减段（100→60）
    return 100 - ((sweepRatio - optimalUpper) / (dangerStart - optimalUpper)) * 40;
  }
  // 危险区
  return Math.max(20, 60 - (sweepRatio - dangerStart) * 20);
}
```

**Step 3**: `detectLiquiditySweep()` 中传入动态上界

需要从调用链获取 `regime` 信息。由于 `detectLiquiditySweep` 已在 `detect-structural-setups.ts` 内部调用，且 `ctx` 已可用：

```typescript
// detect-structural-setups.ts L77：
// 原代码：
const sweepSetups = detectLiquiditySweep(candles4h, config, oiPoints);

// 新代码：
const sweepOptimalUpper = {
  "trend":          config.sweepOptimalUpperTrend,
  "range":          config.sweepOptimalUpperRange,
  "high-volatility": config.sweepOptimalUpperHighVol,
  "event-driven":   config.sweepOptimalUpperHighVol, // 事件驱动使用最保守值
}[ctx.regime] ?? config.sweepOptimalUpperRange;

const sweepSetups = detectLiquiditySweep(candles4h, config, oiPoints, 5, sweepOptimalUpper);
```

`detectLiquiditySweep` 签名追加可选参数：

```typescript
export function detectLiquiditySweep(
  candles: Candle[],
  config: StrategyConfig,
  oiPoints: OpenInterestPoint[] = [],
  sweepWindow = 5,
  sweepOptimalUpper = 1.5  // ← 新增
): StructuralSetup[] {
  // ...
  const depthScore = scoreSweepDepth(sweepRatio, sweepOptimalUpper);
  // ...
}
```

#### 验收标准

- [ ] `regime = "trend"` 时，`sweepRatio = 1.8` 仍在最优区间（评分 > 90）
- [ ] `regime = "high-volatility"` 时，`sweepRatio = 1.8` 已在衰减区（评分 < 80）
- [ ] `sweepOptimalUpper` 未传入时，使用默认值 1.5（向后兼容）
- [ ] 新增单元测试：不同 `optimalUpper` 值下的评分曲线符合预期

---

## P2 优先级任务（中期执行，影响组合风险管理）

### TASK-V2-P2-A：品种集中度检查

**目标文件**: `src/services/risk/evaluate-exposure-gate.ts`  
**涉及文件**: `src/app/config.ts`  
**预计工时**: 1.5h  
**验收方式**: 同一品种持仓超过集中度限制时触发拦截

#### 物理问题

当前风控维度：
- ✅ 全局风险比例上限
- ✅ 同向仓位数量上限  
- ✅ 方向倾斜度保护
- ❌ 品种集中度限制 — **缺失**

当系统扫描单一品种（如 BTCUSDT）时，所有仓位都是同一标的的敞口。即使多空对冲，在极端行情下（如交易所宕机、AMM 清算级联），同一品种的多空仓位可能同时触发止损。

#### 修改方案

**Step 1**: `config.ts` 新增品种集中度配置

```typescript
// StrategyConfig 新增（--- 品种集中度 ---）
readonly maxPositionsPerSymbol: number;       // 单品种最大持仓数（默认 3）
readonly singleSymbolRiskWarning: boolean;    // 单品种模式警告开关（默认 true）

// strategyConfig 默认值
maxPositionsPerSymbol: 3,
singleSymbolRiskWarning: true,
```

**Step 2**: `evaluate-exposure-gate.ts` 增加品种集中度检查

在现有方向倾斜度检查之后、全局风险检查之前插入：

```typescript
// ── TASK-V2-P2-A: 品种集中度保护 ────────────────────────────────────────────
const sameSymbolCount = openPositions.filter(p => p.symbol === candidate.symbol).length;
if (sameSymbolCount >= config.maxPositionsPerSymbol) {
  return {
    action: "block",
    reasonCode: "PORTFOLIO_RISK_LIMIT",
    reason: `品种集中度超限：${candidate.symbol} 已有 ${sameSymbolCount} 个持仓 (上限 ${config.maxPositionsPerSymbol})`
  };
}
```

**Step 3**: 系统启动时输出单品种警告

```typescript
// index.ts — main() 函数开头
if (strategyConfig.singleSymbolRiskWarning) {
  const symbols = [perpSymbol]; // 扫描品种列表
  if (symbols.length === 1) {
    logger.warn(
      { symbol: symbols[0] },
      "⚠️ 单品种模式：所有持仓集中于同一标的。考虑增加扫描品种以分散风险。"
    );
  }
}
```

#### 验收标准

- [ ] 同一品种持仓达到 `maxPositionsPerSymbol` 时，新增同品种信号被拦截
- [ ] 不同品种持仓不受影响
- [ ] 单品种模式启动时终端显示警告
- [ ] `maxPositionsPerSymbol = 999` 时行为等同于禁用（向后兼容）

---

## P3 优先级任务（长期优化，影响大仓位精度）

### TASK-V2-P3-A：CVS 摩擦力引入市场冲击成本

**目标文件**: `src/services/consensus/evaluate-consensus.ts`  
**涉及文件**: `src/app/config.ts`  
**预计工时**: 3h  
**验收方式**: 大仓位信号的 CVS 低于同结构小仓位信号的 CVS

#### 物理问题

当前 CVS 摩擦力只考虑了滑点（`baseSlippagePct`），但忽略了**市场冲击成本**。

```
市场冲击成本 = f(订单大小 / 日均成交额)
```

当仓位规模达到日均成交额的 1% 以上时，订单本身就成为了市场价格变动的一部分。这部分隐性成本会显著拉低真实 EV。

#### 修改方案

**Step 1**: `config.ts` 新增冲击成本参数

```typescript
// StrategyConfig 新增（--- 市场冲击成本 ---）
readonly impactCostSensitivity: number;   // 冲击成本敏感系数（默认 0.1）
readonly impactCostDailyVolumeUsd: number; // 日均成交额基准 USD（默认 1_000_000_000，BTC 约 30B）

// strategyConfig 默认值
impactCostSensitivity: 0.1,
impactCostDailyVolumeUsd: 1_000_000_000,
```

**Step 2**: `computeCVS()` 中追加冲击成本项

```typescript
function computeCVS(
  setup: StructuralSetup,
  regimeAligned: boolean,
  participantAligned: boolean,
  rr: number,
  ctx: MarketContext,
  config: StrategyConfig,
  positionSizeUsd?: number  // ← 新增：可选，传入预估仓位规模
): number {
  // ... 现有推力和滑点摩擦力不变 ...

  // — 市场冲击成本（新增）—
  // 冲击成本 = sensitivity × (positionSize / dailyVolume)²
  // 使用平方关系模拟非线性市场冲击（大单的冲击成本远超线性增长）
  if (positionSizeUsd && positionSizeUsd > 0) {
    const sizeRatio = positionSizeUsd / config.impactCostDailyVolumeUsd;
    const impactCost = config.impactCostSensitivity * Math.pow(sizeRatio, 2);
    effectiveSlippage += impactCost;
  }

  const frictionDenominator = 1 + effectiveSlippage * 100;
  // ...
}
```

> **注意**：此任务需要 `positionSizeUsd` 信息，该信息在当前流水线中位于 CVS 计算**之后**（先算 CVS → 再用 CVS 决定仓位大小）。这是一个鸡生蛋蛋生鸡问题。
>
> **解决方案**：使用 `config.accountSizeUsd × config.riskPerTrade / (1 - riskReward 归一化)` 作为预估仓位规模的近似值，无需精确值。

#### 验收标准

- [ ] `positionSizeUsd = 0` 或未传入时，CVS 与修改前完全一致
- [ ] `positionSizeUsd = dailyVolumeUsd × 1%` 时，CVS 降低约 1%
- [ ] `positionSizeUsd = dailyVolumeUsd × 5%` 时，CVS 降低约 25%
- [ ] 新增单元测试：覆盖不同仓位规模的冲击成本

---

## 执行时间线

```
Week 1（当前周）
  ├── TASK-V2-P0-A: FVG OI 物理门控         [Day 1-2]  ← 消除最大的物理不一致
  ├── TASK-V2-P0-B: 扫描互斥锁              [Day 2]    ← 消除竞态风险
  └── TASK-V2-P0-C: 模拟/实盘数据隔离       [Day 3]    ← 消除模式切换风险

Week 2
  ├── TASK-V2-P1-A: CVD 惩罚连续化          [Day 1]
  ├── TASK-V2-P1-B: 信号半衰期自适应        [Day 1-2]
  └── TASK-V2-P1-C: Sweep 深度区间自适应    [Day 3-4]

Week 3
  ├── TASK-V2-P2-A: 品种集中度检查          [Day 1-2]
  └── TASK-V2-P3-A: CVS 市场冲击成本        [Day 3-5]

Week 4
  └── 全量回测验证 + 审计评分复检            [Day 1-5]
```

---

## 质量门槛（每个任务必须通过）

1. **单元测试覆盖率**：新增代码 ≥ 90% 覆盖率
2. **向后兼容性**：新参数均提供默认值，不破坏现有调用侧
3. **TypeScript 严格类型**：`tsc --noEmit` 零错误
4. **物理诚实性校验**：每个修改必须能用第一性原理语言描述其物理意义
5. **现有测试不破坏**：`pnpm test` 全部通过

---

## 预估影响（审计评分提升）

| 维度 | 当前分 | 修复后预估 | 提升 |
|------|:------:|:---------:|:----:|
| 感应层 (Sensing) | 75 | 90 | +15 |
| 决策层 (Brain) | 85 | 93 | +8 |
| 执行层 (Actuator) | 72 | 90 | +18 |
| 信息熵控制 | 88 | 92 | +4 |
| 物理一致性 | 73 | 93 | +20 |
| 资金安全 | 70 | 92 | +22 |
| **总分** | **78** | **92** | **+14** |

---

---

## 📋 复核勘误（v2.1 — 2026-03-24）

> 本节通过对照真实代码库（`src/` 及 `test/`）逐行验证，记录 V2 计划原文中的错误与遗漏。  
> **执行时以本节修正为准，原文若与本节冲突，以本节为准。**

---

### 勘误 #1 — TASK-V2-P0-A：`detect-fvg.test.ts` 现有测试调用签名将被破坏

**问题位置**: Step 2 修改 `detectFvg` 签名

**错误描述**:  
`test/unit/structure/detect-fvg.test.ts` 中所有测试（共 11 个）均以三参数形式调用：
```typescript
detectFvg(candles, "4h", strategyConfig)
```
原文 Step 2 将新参数 `oiPoints` 插到 `scanWindow` **之后**（第5个参数），`scanWindow` 仍为第4个，这与现有测试兼容（默认值保留）。

**验证结论**：签名设计 ✅ 兼容，但需确认以下细节：

> ⚠️ 原文 Step 2 中 `detectFvg` 完整签名写法是正确的：
> ```typescript
> export function detectFvg(candles, timeframe, config, scanWindow = 30, oiPoints = [])
> ```
> 现有测试只传前3个参数，新参数有默认值，**不会破坏现有测试**。✅

**状态**: 无需修改，但补充说明

---

### 勘误 #2 — TASK-V2-P0-A：`detect-structural-setups.ts` 的实际行号有误

**问题位置**: Step 3 代码注释 `// 原代码 L74`

**错误描述**:  
原文写 `// 原代码 L74`，但查阅实际文件：
- `detect-structural-setups.ts` L74 是注释行（`// ── 3. 检测 FVG`）
- `detectFvg()` 调用实际位于 **L77**
- `detectLiquiditySweep()` 调用实际位于 **L77+1 = L78（错行注释）**

实际代码：
```typescript
// detect-structural-setups.ts L77（实际行号）
const fvgSetups = detectFvg(candles4h, "4h", config);

// L78（实际行号）
const sweepSetups = detectLiquiditySweep(candles4h, config, oiPoints);
```

**修正**: 执行时参考行号仅供导航，以实际文件内容为准。此错误**不影响实施**。

---

### 勘误 #3 — TASK-V2-P0-B：`exclusiveScan` 函数的类型引用缺失

**严重度**: 中

**问题位置**: Step 修改方案，`exclusiveScan` 函数签名

**错误描述**:  
原文写：
```typescript
async function exclusiveScan(trigger: string): Promise<SignalScanResult | null>
```

但 `SignalScanResult` 类型在 `index.ts` 中**未被导入**，当前 `index.ts` 只导入了 `runSignalScan` 函数，其返回类型未被显式引用。需在 `index.ts` 顶部追加 import：

```typescript
// index.ts 顶部追加
import type { SignalScanResult } from "./services/orchestrator/run-signal-scan.js";
```

或将返回类型改为 `Promise<void>` 简化实现（`lastScanAt` 的更新移入 `exclusiveScan` 内部）：

```typescript
// 更简洁的实现——无需暴露 SignalScanResult 类型
async function exclusiveScan(trigger: string): Promise<void> {
  if (isScanning) {
    logger.warn({ trigger }, "Scan 互斥锁生效：跳过本次扫描");
    return;
  }
  isScanning = true;
  try {
    const result = await runSignalScan(perpSymbol, env.SPOT_SYMBOL, scanDeps);
    lastScanAt = result.scannedAt;  // lastScanAt 在闭包中可访问
  } finally {
    isScanning = false;
  }
}
```

**推荐方案**: 使用 `Promise<void>` 版本，因为 `lastScanAt` 赋值已在闭包内完成，无需返回值。

---

### 勘误 #4 — TASK-V2-P0-C：数据库迁移位置错误

**严重度**: 高

**问题位置**: Step 1 — 迁移代码放到了 `init-db.ts`

**错误描述**:  
原文将 `positions` 表的迁移逻辑写在 `src/services/persistence/init-db.ts` 中。但实际上 `positions` 表**不在 `init-db.ts` 中管理**！

查阅实际代码：
- `init-db.ts`：管理 `candles`, `scan_logs`, `candidates`, `candidate_snapshots` 表
- `init-positions-db.ts`：管理 `positions` 表 ← **正确文件**

`positions` 表的初始化在 `src/services/positions/init-positions-db.ts`，且已有 `exchange_order_id` 的迁移先例（L35-38）：

```typescript
// init-positions-db.ts L35-38 — 已有的迁移模式
try {
  db.prepare("ALTER TABLE positions ADD COLUMN exchange_order_id TEXT").run();
} catch (e) {
  // column already exists
}
```

**修正方案**: Step 1 的迁移代码必须写在 `src/services/positions/init-positions-db.ts`，完全照搬已有模式：

```typescript
// init-positions-db.ts — 在现有 CREATE TABLE 和 exchange_order_id 迁移之后追加
try {
  db.prepare("ALTER TABLE positions ADD COLUMN execution_mode TEXT DEFAULT 'paper'").run();
} catch (e) {
  // column already exists — idempotent migration
}
```

> **同时**: 在 `CREATE TABLE` 语句中**也要加上** `execution_mode` 列，这样新建数据库（非迁移场景）也有该列：
> ```sql
> execution_mode  TEXT NOT NULL DEFAULT 'paper'
> ```

**`init-db.ts` 无需改动**。

---

### 勘误 #5 — TASK-V2-P0-C：`track-position.ts` 直接 `import env` 会破坏单元测试

**严重度**: 高

**问题位置**: Step 3 — `openPosition` 和 `getOpenPositions` 内部 `import { env }`

**错误描述**:  
原文建议在 `track-position.ts` 内部 `import { env }` 并使用 `env.EXECUTION_MODE`。

查阅 `test/unit/positions/track-position.test.ts`：
```typescript
// 测试使用内存数据库，不经过 env 配置
db = new Database(":memory:");
initPositionsDb(db);
// 直接调用 openPosition(db, ...) — 不会设置 EXECUTION_MODE 环境变量
```

如果 `getOpenPositions` 内部读取 `env.EXECUTION_MODE`，而测试环境 `NODE_ENV=test` 时 `EXECUTION_MODE` 默认为 `"paper"`，则：
- 测试中 `openPosition` 将写入 `execution_mode = 'paper'` ✅
- 测试中 `getOpenPositions` 查询 `WHERE execution_mode = 'paper'` ✅

看似没问题，但这引入了**环境变量隐式依赖**，使纯粹的单元测试对全局状态产生耦合。

**修正方案**: 将 `executionMode` 作为**显式参数**传入，而非从 `env` 全局读取：

```typescript
// track-position.ts — 修改 openPosition 签名
export function openPosition(
  db: Database.Database,
  candidate: TradeCandidate,
  openedAt: number,
  options: {
    recommendedPositionSize?: number;
    recommendedBaseSize?: number;
    riskAmount?: number;
    accountRiskPercent?: number;
    exchangeOrderId?: string;
    executionMode?: "paper" | "live";  // ← 新增可选参数
  } = {}
): void {
  const executionMode = options.executionMode ?? "paper";
  // ...
}

// track-position.ts — 修改 getOpenPositions 签名
export function getOpenPositions(
  db: Database.Database,
  executionMode: "paper" | "live" = "paper"  // ← 新增参数，默认 paper
): OpenPosition[] {
  const rows = db.prepare(
    "SELECT * FROM positions WHERE status = 'open' AND execution_mode = ?"
  ).all(executionMode) as any[];
  return rows.map(mapRowToOpenPosition);
}
```

调用侧（`run-signal-scan.ts` 和 `index.ts`）传入 `env.EXECUTION_MODE`：

```typescript
// run-signal-scan.ts 中
openPosition(db, candidate, scannedAt, {
  ...,
  executionMode: env.EXECUTION_MODE,
});

// monitor-positions.ts 中
const openPositions = getOpenPositions(db, env.EXECUTION_MODE);

// track-position.ts 中的 getOpenRiskSummary 同理
export function getOpenRiskSummary(
  db: Database.Database,
  direction?: "long" | "short",
  executionMode: "paper" | "live" = "paper"
)
```

**这样单元测试不需要任何改动**，依旧传入默认的 `"paper"` 参数隐式生效。

---

### 勘误 #6 — TASK-V2-P1-A：CVD 验收标准数值与公式不一致

**严重度**: 低

**问题位置**: 验收标准第 3 条

**错误描述**:  
原文写：
```
cvdSlope = -0.05（看跌），对看涨 Sweep：cvdBonus ≈ -2（轻微反向，轻惩罚）
```

按原文的二次方公式 `penalty = min(25, round(absSlope² × 625))`：
- `absSlope = 0.05`
- `penalty = round(0.05² × 625) = round(0.0025 × 625) = round(1.5625) = 2`
- **实际结果 = -2** ✅

原文数值是正确的，但应补充说明精确计算过程，避免实施者误解：

```
cvdSlope = -0.10 → penalty = round(0.01 × 625) = 6  → cvdBonus = -6
cvdSlope = -0.20 → penalty = round(0.04 × 625) = 25 → cvdBonus = -25（触及上限）
cvdSlope = -0.05 → penalty = round(0.0025 × 625) = 2 → cvdBonus = -2
```

**状态**: 数值正确，补充说明即可。

---

### 勘误 #7 — TASK-V2-P1-B：`MarketRegime` 类型已在 `evaluate-consensus.ts` 中导入

**严重度**: 低

**问题位置**: Step 2，`getRegimeHalfLife` 函数的 import 说明

**错误描述**:  
原文建议：
```typescript
import type { MarketRegime } from "../../domain/regime/market-regime.js";
```

但查阅 `evaluate-consensus.ts` L3，该 import **已存在**：
```typescript
import type { MarketRegime } from "../../domain/regime/market-regime.js";
```

**状态**: 无需新增 import。实施时直接定义 `getRegimeHalfLife` 函数即可。

---

### 勘误 #8 — TASK-V2-P1-C：`scoreSweepDepth` 当 `sweepRatio ≤ 0.5 且 optimalUpper ≤ 0.5` 时存在数学错误

**严重度**: 中

**问题位置**: Step 2，重构后的 `scoreSweepDepth()` 最优区间计算

**错误描述**:  
原文重构后的公式：
```typescript
if (sweepRatio <= optimalUpper) {   // 最优区间（80→100）
  return 80 + ((sweepRatio - 0.5) / (optimalUpper - 0.5)) * 20;
}
```

当 `optimalUpper = 1.2`（高波动市）且 `sweepRatio = 0.6`（在爬坡段之后、最优区间内）时：
- 分子：`0.6 - 0.5 = 0.1`
- 分母：`1.2 - 0.5 = 0.7`
- 结果：`80 + (0.1/0.7) × 20 ≈ 82.9` ✅ 合理

**但存在边界问题**：当 `sweepRatio = 0.5`（爬坡上界）同时 `optimalUpper = 0.5`（理论上不可能，但防御性编程需考虑）时，`optimalUpper - 0.5 = 0`，**除零错误**。

**修正**：增加防御性检查：
```typescript
if (sweepRatio <= optimalUpper) {   // 最优区间（80→100）
  const span = optimalUpper - 0.5;
  if (span <= 0) return 80; // 防御性：区间退化时返回基础分
  return 80 + ((sweepRatio - 0.5) / span) * 20;
}
```

实际配置中 `sweepOptimalUpperHighVol = 1.2`，远大于 0.5，**生产环境不会触发**，但单元测试极端值可能命中。

---

### 复核总结

| 编号 | 任务 | 问题类型 | 严重度 | 状态 |
|------|------|---------|-------|------|
| #1 | P0-A | 函数签名向后兼容性说明缺失 | 低 | ✅ 已澄清 |
| #2 | P0-A | 注释中行号不准确（L74 vs L77）| 低 | ✅ 已说明：以内容为准 |
| #3 | P0-B | `SignalScanResult` 类型引用缺失 | 中 | ✅ 已给出 `Promise<void>` 简化方案 |
| #4 | P0-C | **迁移代码写错文件（`init-db.ts` vs `init-positions-db.ts`）** | **高** | ✅ 已修正：必须写在 `init-positions-db.ts` |
| #5 | P0-C | **`env` 全局依赖破坏单元测试隔离性** | **高** | ✅ 已修正：改为显式参数注入 |
| #6 | P1-A | 验收标准数值说明不够清晰 | 低 | ✅ 已补充计算过程 |
| #7 | P1-B | `MarketRegime` import 实际已存在，无需新增 | 低 | ✅ 已澄清 |
| #8 | P1-C | `scoreSweepDepth` 重构后存在潜在除零风险 | 中 | ✅ 已给出防御性修正 |

> **关键执行提示**:  
> - 执行 P0-C 时，**必须修改 `init-positions-db.ts`，而非 `init-db.ts`**（勘误 #4）  
> - 执行 P0-C 时，**`executionMode` 必须作为显式参数传入，而非在函数内读取 `env`**（勘误 #5）  
> - 执行 P0-B 时，`exclusiveScan` 返回类型使用 `Promise<void>`，无需导入 `SignalScanResult`（勘误 #3）  
> - 执行 P1-C 时，在最优区间计算中加入除零防护（勘误 #8）

---

## 与 V1 优化计划的关系

> [!IMPORTANT]
> 本 V2 计划与 [OPTIMIZATION_PLAN.md](OPTIMIZATION_PLAN.md)（V1）**互补而非替代**。
>
> V1 计划的 P0-A（OI 方向性）、P0-B（CVS 摩擦力）、P1-A（Sweep 非线性）、P1-B（CSP 动态门槛）、P1-C（CVD 接入）、P2-A（信号衰减）、P2-B（OI 快速监控）、P2-C（TP 可达性）**已全部实施完成**。
>
> V2 计划聚焦于 V1 实施后仍然存在的物理缝隙，以及审计中新发现的架构级问题。

```
V1 计划状态: ████████████ 100% 完成
V2 计划状态: ░░░░░░░░░░░░   0% 待执行
```

---

> **"First principles thinking is looking at the fundamentals so carefully that you can construct the truth from the ground up. Everything else is just reasoning by analogy."**  
>  
> 本计划的每一项修复都不是在"补漏洞"，而是在问：  
> **"从物理真相出发，这段代码应该是什么样的？"** 🚀

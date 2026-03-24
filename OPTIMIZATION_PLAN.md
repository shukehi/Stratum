# Stratum 波段交易策略优化执行计划

> **版本**: v1.0  
> **制定日期**: 2026-03-24  
> **基础原则**: 第一性原理 — 从交易的底层物理出发，系统性消除感应层盲点、决策层残缺和执行层延迟  
> **执行顺序**: P0 → P1 → P2 → P3（严格按优先级，不跨级并行）

---

## 核心诊断摘要

交易的底层物理方程：

```
EV = P(Win) × Gain − P(Loss) × Loss > 0
```

当前 Stratum v2.0 的三处物理短路：

| 短路位置 | 表现 | 影响 |
|---------|------|------|
| 感应层 | OI 坍缩检测丢弃方向性信息 | 约 30% 信号方向错误 |
| 决策层 | CVS 公式缺少摩擦力分母 | EV 高估，真实期望被稀释 |
| 调度层 | 4h 时钟轮询替代事件触发 | 平均入场延迟 ~2h |

---

## P0 优先级任务（立即执行，影响系统基本诚实性）

### TASK-P0-A：OI 坍缩方向性增强

**目标文件**: `src/services/analysis/detect-oi-crash.ts`  
**涉及文件**: `src/services/structure/detect-liquidity-sweep.ts`  
**预计工时**: 2–3h  
**验收方式**: 单元测试覆盖三种方向场景

#### 物理问题

`detectOiCrash()` 当前只返回 `isCrash: boolean`，丢弃了坍缩时的价格方向。

`OI↓ + Price↓`（多头被强平）与 `OI↓ + Price↑`（空头被强平）是**完全不同的物理事件**，但当前系统将它们等同对待，导致 Sweep 方向与清算机制错位。

#### 修改方案

**Step 1**: 扩展 `OiCrashResult` 类型（`detect-oi-crash.ts`）

> **注意**：函数中有两处样本不足的早返回路径（`oiPoints.length < 10` 和 `rates.length < 5`），这两处也必须补充 `mechanismType: "unknown"` 和 `priceChangePct: 0`，否则 TypeScript 类型检查会报错。

```typescript
export type OiLiquidationMechanism =
  | "long_liquidation"   // OI↓ + Price↓ → 多头被清算 → 支持看涨 Sweep
  | "short_squeeze"      // OI↓ + Price↑ → 空头被清算 → 支持看跌 Sweep  
  | "mixed_deleveraging" // OI↓ + Price 震荡 → 双向排毒，方向不明
  | "unknown";           // 样本不足

export type OiCrashResult = {
  isCrash: boolean;
  crashIndex: number;
  currentRate: number;
  threshold: number;
  reason: string;
  // 新增字段
  mechanismType: OiLiquidationMechanism;
  priceChangePct: number; // 同期价格变化百分比（正=上涨，负=下跌）
};
```

**Step 2**: 修改 `detectOiCrash()` 签名，接受同期价格数据

```typescript
export function detectOiCrash(
  oiPoints: OpenInterestPoint[],
  // 新增：可选的近期收盘价序列（无需与 oiPoints 等长）
  // 函数内部只取 closePrices.slice(-2) 判断最近价格方向
  // 调用方直接传 candles4h.map(c => c.close) 即可
  closePrices?: number[],
  lookback = 50,
  sigmaThreshold = 3.0
): OiCrashResult {
  // ... 现有统计逻辑不变 ...

  // 新增：方向性判断（仅取最近2个收盘价，与 oiPoints 长度无关）
  let mechanismType: OiLiquidationMechanism = "unknown";
  let priceChangePct = 0;

  if (closePrices && closePrices.length >= 2) {
    const recentPrices = closePrices.slice(-2); // 只取最近2根
    priceChangePct = (recentPrices[1] - recentPrices[0]) / recentPrices[0];
    const PRICE_DIRECTION_THRESHOLD = 0.001; // 0.1% 以内视为横盘

    if (priceChangePct < -PRICE_DIRECTION_THRESHOLD) {
      mechanismType = "long_liquidation";   // OI↓ + Price↓ → 多头被清算
    } else if (priceChangePct > PRICE_DIRECTION_THRESHOLD) {
      mechanismType = "short_squeeze";       // OI↓ + Price↑ → 空头被逼空
    } else {
      mechanismType = "mixed_deleveraging"; // OI↓ + Price≈0 → 双向排毒
    }
  }

  return { ..., mechanismType, priceChangePct };
}
```

**Step 3**: `detect-liquidity-sweep.ts` 中加入方向校验

> ⚠️ **执行依赖**：Step 3 的代码中使用了 `depthScore` 变量（来自 P1-A 的 `scoreSweepDepth()` 函数）。  
> 如果 P1-A 尚未实施，Step 3 中请暂时保留原有线性公式 `65 + sweepRatio × 20`，待 P1-A 完成后再替换为 `depthScore`。

`mechanismType` 与 Sweep 信号方向的**正确**对应关系：

| `mechanismType` | 吻合的 Sweep 方向 | 物理解释 | 评分调整 |
|---|---|---|---|
| `long_liquidation`（OI↓+Price↓）| 看涨 Sweep | 多头被强平 → 低点被扫 → 反弹 | +5 |
| `long_liquidation`（OI↓+Price↓）| 看跌 Sweep | 与清算方向不吻合 | -15 |
| `short_squeeze`（OI↓+Price↑）| 看跌 Sweep | 空头被逼空 → 高点被扫 → 回落 | +5 |
| `short_squeeze`（OI↓+Price↑）| 看涨 Sweep | 与清算方向不吻合 | -15 |
| `mixed_deleveraging` | 任意方向 | 双向排毒，方向不明 | -10（全局）|

```typescript
export function detectLiquiditySweep(
  candles: Candle[],
  config: StrategyConfig,
  oiPoints: OpenInterestPoint[] = [],
  sweepWindow = 5
): StructuralSetup[] {
  if (candles.length < 10) return [];

  // 传入近期收盘价（无需等长，内部只取 slice(-2)）
  const closePrices = candles.map(c => c.close);
  const oiResult = detectOiCrash(oiPoints, closePrices);

  if (!oiResult.isCrash) return [];

  // mixed_deleveraging 时全局降权 -10（不阻止信号）
  const directionPenalty = oiResult.mechanismType === "mixed_deleveraging" ? -10 : 0;

  // ... 其余 Sweep 检测逻辑（baselineAtr、swingPoints 等不变） ...

  // 看涨 Sweep：long_liquidation 吻合 → +5；short_squeeze 背离 → -15
  if (matchedLow) {
    const mechanismBonus = oiResult.mechanismType === "long_liquidation" ? 5
                         : oiResult.mechanismType === "short_squeeze"    ? -15
                         : 0;
    const structureScore = clamp(
      Math.round(depthScore + momentumBonus + mechanismBonus + directionPenalty),
      0, 100
    );
    // ...push setup...
  }

  // 看跌 Sweep：short_squeeze 吻合 → +5；long_liquidation 背离 → -15
  if (matchedHigh) {
    const mechanismBonus = oiResult.mechanismType === "short_squeeze"    ? 5
                         : oiResult.mechanismType === "long_liquidation" ? -15
                         : 0;
    const structureScore = clamp(
      Math.round(depthScore + momentumBonus + mechanismBonus + directionPenalty),
      0, 100
    );
    // ...push setup...
  }
}
```

**Step 4**: `run-signal-scan.ts` 传入收盘价（调用侧更新）

```typescript
// 感应层调用时同步传入收盘价
const oiCrashResult = detectOiCrash(
  openInterest,
  candles4h.map(c => c.close) // 新增
);
```

#### 验收标准
- [ ] `mechanismType` 在 `long_liquidation` 时，看空 Sweep 的 `structureScore` 降低 ≥ 15 分
- [ ] `mechanismType` 在 `short_squeeze` 时，看多 Sweep 的 `structureScore` 降低 ≥ 15 分
- [ ] 新增单元测试：`detect-oi-crash.test.ts` 覆盖三种方向场景
- [ ] 现有测试全部通过

---

### TASK-P0-B：CVS 公式引入滑点摩擦力

**目标文件**: `src/services/consensus/evaluate-consensus.ts`  
**涉及文件**: `src/app/config.ts`  
**预计工时**: 2h  
**验收方式**: CVS 在高波动时段 < 低波动时段同结构信号的 CVS

#### 物理问题

当前 CVS = 结构分 × 对齐 × RR 奖励，只有"推力"没有"摩擦力"。

```
CVS（物理完整版）= 推力 / 摩擦力
```

摩擦力在低流动性时段（亚洲盘）、高滑点代币会显著拉高，使得表面相同的结构信号产生完全不同的实际期望值。

#### 修改方案

**Step 1**: `config.ts` 新增滑点参数

```typescript
// StrategyConfig 新增字段（--- 摩擦力参数 --- 区块）
readonly baseSlippagePct: number;          // 基础滑点（默认 0.001 = 0.1%）
readonly sessionSlippageMultiplier: number; // 低流动性时段滑点倍数（默认 2.5）

// strategyConfig 默认值
baseSlippagePct: 0.001,
sessionSlippageMultiplier: 2.5,
```

**Step 2**: `evaluate-consensus.ts` 重构 `computeCVS()`

```typescript
/**
 * CVS 2.0 — 物理完整速度方程
 *
 * CVS = (结构评分 × 对齐乘数 × RR奖励 × 确认系数 × 时段系数)
 *        / (1 + 有效滑点摩擦系数)
 *
 * 物理意义：摩擦力越高，资本流速越低。在高滑点环境中，
 * 即使结构极好，实际可获得的期望也会被摩擦吃掉。
 */
function computeCVS(
  setup: StructuralSetup,
  regimeAligned: boolean,
  participantAligned: boolean,
  rr: number,
  ctx: MarketContext,
  config: StrategyConfig  // 新增：传入 config 以获取滑点参数
): number {
  // — 推力部分（不变）—
  let multiplier = 1.0;
  if (regimeAligned && participantAligned) multiplier = 1.2;
  else if (!regimeAligned && !participantAligned) multiplier = 0.8;

  let numerator = setup.structureScore * multiplier;

  if (ctx.regime === "high-volatility" || ctx.regime === "event-driven") {
    numerator *= 0.9;
  }
  if (rr >= 3.0) numerator *= 1.1;
  if (setup.confirmationStatus === "pending") numerator *= 0.8;

  // — 摩擦力部分（新增）—
  // 基础滑点（双向：入场+出场，所以 ×2）
  let effectiveSlippage = config.baseSlippagePct * 2;

  // 低流动性时段：滑点倍增
  // 注意：现有代码在 L59 已有 `baseScore *= 0.9` 的时段惩罚，此处不再重复。
  // 只需在现有 SESSION_LOW_LIQUIDITY_DISCOUNT 分支内追加滑点倍增逻辑：
  if (ctx.reasonCodes.includes("SESSION_LOW_LIQUIDITY_DISCOUNT")) {
    effectiveSlippage *= config.sessionSlippageMultiplier;
    // ← 不再重复 numerator *= 0.9（原有 L59 已处理）
  }

  // 将滑点转换为摩擦系数（将百分比滑点映射到 CVS 评分空间）
  // 物理意义：0.1% 的单边滑点 → 对 100 分满分信号产生约 10 分的摩擦惩罚
  const frictionDenominator = 1 + effectiveSlippage * 100;
  const cvs = numerator / frictionDenominator;

  return Math.round(cvs * 100) / 100;
}
```

**Step 3**: 更新 `evaluateConsensus` 中的 `computeCVS` 调用，传入 `config`

> **注意**：`config` 参数在 `analyzeConsensus(input)` 中已通过 `input.config` 可访问，直接传入即可，无需新增参数。

```typescript
// evaluate-consensus.ts L138（当前）
const cvs = computeCVS(setup, regimeAligned, pAligned, rr, ctx);
// 改为
const cvs = computeCVS(setup, regimeAligned, pAligned, rr, ctx, input.config);
```

#### 验收标准
- [ ] 低流动性时段信号的 CVS 比标准时段相同结构信号低 ≥ 8%
- [ ] `baseSlippagePct = 0` 时，CVS 结果与修改前完全一致（向后兼容）
- [ ] 新增单元测试：覆盖有/无摩擦力的 CVS 对比场景

---

## P1 优先级任务（短期，影响信号质量上限）

### TASK-P1-A：Sweep 深度评分非线性化

**目标文件**: `src/services/structure/detect-liquidity-sweep.ts`  
**预计工时**: 1.5h  
**验收方式**: sweepRatio > 2.5 时 structureScore < 70

#### 物理问题

当前评分 `65 + sweepRatio × 20` 是线性函数。

物理现实：过深的 Sweep（> 2.5x ATR）不是强确认，而是**结构可能已翻转**的信号：真正的主力方向反转，不是"更好的 Sweep"。线性公式对过深 Sweep 给出虚高评分，违背第一性原理。

#### 修改方案

在 `detect-liquidity-sweep.ts` 中新增辅助函数，替代原有的线性评分：

```typescript
/**
 * Sweep 深度非线性评分（倒 U 型曲线）
 *
 * sweepRatio（刺穿深度 / ATR）与信号质量的物理关系：
 *   < 0.3x ATR  → 深度不足：未触发足量止损，动能湮灭不充分 → 40分基础
 *   0.3–0.5x    → 过渡区：线性增长爬坡
 *   0.5–1.5x    → 最优区间：止损湮灭充分 + 价格能收回 → 80–100分
 *   1.5–2.5x    → 衰减区：深度过大，收回难度上升 → 线性下降
 *   > 2.5x ATR  → 危险区：可能已是结构翻转而非 Sweep → 强制降权
 */
function scoreSweepDepth(sweepRatio: number): number {
  if (sweepRatio < 0.3) {
    return 40; // 深度不足
  }
  if (sweepRatio <= 0.5) {
    // 0.3–0.5：爬坡段（40→80）
    return 40 + ((sweepRatio - 0.3) / 0.2) * 40;
  }
  if (sweepRatio <= 1.5) {
    // 0.5–1.5：最优区间（80→100）
    return 80 + ((sweepRatio - 0.5) / 1.0) * 20;
  }
  if (sweepRatio <= 2.5) {
    // 1.5–2.5：衰减段（100→60）
    return 100 - ((sweepRatio - 1.5) / 1.0) * 40;
  }
  // > 2.5：危险区（强制 ≤ 50，且越深越低）
  return Math.max(20, 60 - (sweepRatio - 2.5) * 20);
}
```

替换原有评分逻辑：

```typescript
// 原代码（L98）：
// const structureScore = clamp(Math.round(65 + sweepRatio * 20 + momentumBonus), 0, 100);

// 新代码：
const depthScore = scoreSweepDepth(sweepRatio);
const structureScore = clamp(Math.round(depthScore + momentumBonus), 0, 100);
```

#### 验收标准
- [ ] `sweepRatio = 3.0` 时，`structureScore` 基础分 ≤ 40（配合 momentumBonus 后合理）
- [ ] `sweepRatio = 1.0` 时，`structureScore` 基础分 = 90
- [ ] `sweepRatio = 0.2` 时，`structureScore` 基础分 = 40
- [ ] 新增单元测试：`scoreSweepDepth` 在各区间的输出值符合预期

---

### TASK-P1-B：CSP 动态置换门槛

**目标文件**: `src/services/risk/evaluate-exposure-gate.ts`  
**涉及文件**: `src/app/config.ts`  
**预计工时**: 1.5h  
**验收方式**: 高波动市场下置换门槛 > 趋势市场置换门槛

#### 物理问题

当前 `SWAP_THRESHOLD_RATIO = 1.2` 硬编码。

不同市场状态下，信号的噪声率不同，置换摩擦成本也不同：
- 趋势市方向明确 → 可以积极置换（低门槛）
- 高波动市信号可靠性下降 → 应大幅保守（高门槛）

#### 修改方案

**Step 1**: `config.ts` 新增分状态置换阈值

```typescript
// StrategyConfig 新增（--- CSP 资本置换协议 ---）
readonly cspSwapThresholdTrend: number;         // 趋势市置换门槛（默认 1.1）
readonly cspSwapThresholdRange: number;          // 震荡市置换门槛（默认 1.25）
readonly cspSwapThresholdHighVolatility: number; // 高波动市置换门槛（默认 1.5）
readonly cspSwapThresholdEventDriven: number;    // 事件驱动市（默认 999，禁止置换）

// strategyConfig 默认值
cspSwapThresholdTrend: 1.1,
cspSwapThresholdRange: 1.25,
cspSwapThresholdHighVolatility: 1.5,
cspSwapThresholdEventDriven: 999,
```

**Step 2**: `ExposureGateInput` 接受当前 regime 信息

```typescript
export type ExposureGateInput = {
  candidate: TradeCandidate;
  openPositions: OpenPosition[];
  portfolioOpenRiskPercent: number;
  config: StrategyConfig;
  currentRegime?: MarketRegime; // 新增（可选，向后兼容）
  regimeConfidence?: number;    // 新增（可选）
};
```

**Step 3**: `evaluateSwappingGate()` 使用动态阈值

```typescript
// 在置换逻辑中替换硬编码常量
function getDynamicSwapThreshold(
  regime: MarketRegime | undefined,
  confidence: number,
  config: StrategyConfig
): number {
  const baseThreshold = {
    "trend":          config.cspSwapThresholdTrend,
    "range":          config.cspSwapThresholdRange,
    "high-volatility": config.cspSwapThresholdHighVolatility,
    "event-driven":   config.cspSwapThresholdEventDriven,
  }[regime ?? "range"] ?? config.cspSwapThresholdRange;

  // 置信度低时进一步收紧（每低 10% 置信度，门槛额外 +0.05）
  const confidenceAdj = confidence < 70 ? (70 - confidence) / 10 * 0.05 : 0;
  return baseThreshold + confidenceAdj;
}

// 在 evaluateSwappingGate() 中使用
const SWAP_THRESHOLD_RATIO = getDynamicSwapThreshold(
  input.currentRegime,
  input.regimeConfidence ?? 70,
  config
);
```

**Step 4**: `run-signal-scan.ts` 中传入 regime 上下文

> 注意：`regimeDecision.confidence` 已被 `buildMarketContext()` 映射到 `ctx.regimeConfidence`，  
> 直接从 `ctx` 读取，无需额外引用 `regimeDecision` 变量。

```typescript
const swappingDecision = evaluateSwappingGate({
  candidate,
  openPositions,
  portfolioOpenRiskPercent: portfolioExposure.openRiskPercent,
  config,
  currentRegime: ctx.regime,              // 从 ctx 获取
  regimeConfidence: ctx.regimeConfidence, // 从 ctx.regimeConfidence 获取（已映射）
});
```

#### 验收标准
- [ ] `regime = "event-driven"` 时，任何置换请求都返回 `block`
- [ ] `regime = "trend"` 时，新信号 CVS 超出旧信号 10% 即可触发置换
- [ ] `regime = "high-volatility"` 时，需要超出 50% 才能触发置换
- [ ] 新增单元测试：覆盖 4 种 regime 下的置换决策

---

### TASK-P1-C：CVD 加速度接入感应层门控

**目标文件**: `src/services/structure/detect-liquidity-sweep.ts`  
**涉及文件**: `src/services/analysis/compute-cvd.ts`, `src/app/config.ts`  
**预计工时**: 2.5h  
**验收方式**: CVD 反向时 Sweep 信号的 structureScore 降低 ≥ 10 分

#### 物理问题

OI 坍缩 = 清算（被动力量）  
CVD 加速 = 订单流冲击（主动力量）

真正的能量释放需要**两个维度同时确认**。仅有 OI 没有 CVD，信号的主动力量支撑未验证。

#### 修改方案

**Step 1**: `compute-cvd.ts` 新增加速度计算函数

```typescript
export type CvdAccelerationResult = {
  isAccelerating: boolean;  // CVD 是否在加速（动能增强）
  accelerationScore: number; // 加速度评分（0–100）
  direction: "bullish" | "bearish" | "neutral";
  cvdSlope: number;
};

/**
 * 计算 CVD 加速度（动能变化率）
 * 将窗口三等分，对比最后 1/3 与前 2/3 的 CVD 斜率变化
 */
export function computeCvdAcceleration(
  candles: Candle[],
  window = 12
): CvdAccelerationResult {
  const recent = candles.slice(-window);
  if (recent.length < 6) {
    return { isAccelerating: false, accelerationScore: 50, direction: "neutral", cvdSlope: 0 };
  }

  const third = Math.floor(recent.length / 3);
  const earlyCandles = recent.slice(0, third * 2);
  const lateCandles  = recent.slice(third * 2);

  const totalVol = recent.reduce((s, c) => s + c.volume, 0) || 1;
  const earlyDelta = earlyCandles.reduce((s, c) => s + approxDelta(c), 0);
  const lateDelta  = lateCandles.reduce((s, c) => s + approxDelta(c), 0);

  // 归一化斜率：后段比前段的动能变化
  const earlySlope = earlyDelta / (totalVol * 2 / 3);
  const lateSlope  = lateDelta  / (totalVol * 1 / 3);
  const acceleration = lateSlope - earlySlope;

  const direction: "bullish" | "bearish" | "neutral" =
    lateSlope > 0.03 ? "bullish" : lateSlope < -0.03 ? "bearish" : "neutral";

  const isAccelerating = Math.abs(lateSlope) > Math.abs(earlySlope) * 1.2;
  const accelerationScore = Math.min(100, 50 + Math.abs(acceleration) * 500);

  return { isAccelerating, accelerationScore, direction, cvdSlope: lateSlope };
}
```

**Step 2**: `detect-liquidity-sweep.ts` 接受 CVD 数据并应用加速度修正

```typescript
export function detectLiquiditySweep(
  candles: Candle[],
  config: StrategyConfig,
  oiPoints: OpenInterestPoint[] = [],
  sweepWindow = 5
): StructuralSetup[] {
  // ... OI 门控（不变）...

  // 新增：CVD 加速度分析（使用 candles 本身，无需额外传参）
  const cvdAcc = computeCvdAcceleration(candles, 12);

  // ...Sweep 检测循环中应用 CVD 修正...
  if (matchedLow) {
    // 看涨 Sweep：CVD 方向 bullish → 确认 (+5)；bearish → 惩罚 (-10)
    const cvdBonus = cvdAcc.direction === "bullish" ? 5
                   : cvdAcc.direction === "bearish" ? -10 : 0;
    const structureScore = clamp(
      Math.round(depthScore + momentumBonus + mechanismBonus + directionPenalty + cvdBonus),
      0, 100
    );
    // 新增 reason 说明
    const cvdReason = `CVD加速(${cvdAcc.direction}, slope=${cvdAcc.cvdSlope.toFixed(3)})`;
    // ...
  }
}
```

**Step 3**: `config.ts` 新增 CVD 加速度开关

```typescript
readonly requireCvdAlignmentForSweep: boolean; // 是否要求 CVD 方向对齐（默认 false，降权但不屏蔽）
```

#### 验收标准
- [ ] `cvdAcceleration.direction = "bearish"` 时，看涨 Sweep 的 `structureScore` 降低 ≥ 10 分
- [ ] `cvdAcceleration.direction = "bullish"` 时，看涨 Sweep 的 `structureScore` 提升 +5 分
- [ ] `computeCvdAcceleration` 有独立单元测试

---

## P2 优先级任务（中期，影响系统精度与响应速度）

### TASK-P2-A：信号半衰期衰减

**目标文件**: `src/services/consensus/evaluate-consensus.ts`（定义 `applySignalDecay` 函数）  
**涉及文件**: `src/services/risk/evaluate-exposure-gate.ts`（调用衰减函数进行置换比较）  
**预计工时**: 2h

#### 物理问题

信号有时效性。4h 蜡烛收盘产生的 Sweep 信号，在 2 小时后仍有效，但在接近下根 4h 收盘前，其结构边界已被重新定价，CVS 应随时间衰减。

#### 修改方案

在 `evaluate-consensus.ts` 中新增衰减函数，供仓位监控时调用：

```typescript
/**
 * 信号半衰期衰减
 *
 * 使用指数衰减模型：CVS(t) = CVS(0) × 0.5^(t / halfLife)
 * 默认 halfLife = 2h（与 Stratum 的 4h 主周期匹配）
 *
 * @param cvs         原始 CVS 分数
 * @param signalAgeMs 信号年龄（毫秒）
 * @param halfLifeMs  半衰期（默认 2h = 7_200_000ms）
 * @returns           衰减后的 CVS（最低不低于原始 CVS 的 20%）
 */
export function applySignalDecay(
  cvs: number,
  signalAgeMs: number,
  halfLifeMs = 2 * 3_600_000
): number {
  const decayFactor = Math.pow(0.5, signalAgeMs / halfLifeMs);
  const decayed = cvs * decayFactor;
  // 下限保护：最多衰减到原始 CVS 的 20%（避免信号变为 0）
  const floor = cvs * 0.2;
  return Math.max(Math.round(decayed * 100) / 100, floor);
}
```

在 CSP 置换评估中使用衰减后的 CVS：

```typescript
// evaluate-exposure-gate.ts 中的 weakestPosition 比较
// 应使用衰减后的持仓 CVS 进行比较
const positionAge = Date.now() - weakestPosition.openedAt;
const decayedPositionCvs = applySignalDecay(
  weakestPosition.capitalVelocityScore,
  positionAge
);
// 用 decayedPositionCvs 替换 weakestPosition.capitalVelocityScore 进行比较
```

#### 验收标准
- [ ] 信号年龄 2h 时，CVS 衰减至原始值的 50%
- [ ] 信号年龄 6h 时，CVS 衰减至原始值的 12.5%（但不低于 20% 下限）
- [ ] CSP 置换评估能正确使用衰减 CVS

---

### TASK-P2-B：调度器 OI 快速监控（阶段 1 升级）

**目标文件**: `src/services/scheduler/run-scheduler.ts`  
**涉及文件**: `src/index.ts`  
**预计工时**: 3h

#### 物理问题

当前 4h 轮询导致平均入场延迟 ~2h。最小代价升级：在不重写调度器的前提下，增加 5min OI 快速监控，当 OI 变化率突破 **2-Sigma 预警线**（低于 3-Sigma 门控）时立即触发完整扫描。

#### 修改方案

**Step 1**: 扩展 `SchedulerV2Config`

```typescript
export type SchedulerV2Config = {
  scanSymbols: string[];
  onScan: (symbols: string[]) => Promise<unknown>;
  onMonitor: () => Promise<unknown>;
  onSession: () => Promise<unknown>;
  onHeartbeat: () => Promise<unknown>;
  // 新增：快速 OI 预警检查
  onOiWatch?: (symbols: string[]) => Promise<{ shouldTriggerScan: boolean }>;
};

export type SchedulerV2Intervals = {
  scanIntervalMs?: number;
  monitorIntervalMs?: number;
  sessionIntervalMs?: number;
  heartbeatIntervalMs?: number;
  // 新增
  oiWatchIntervalMs?: number; // 默认 5min
};
```

**Step 2**: `runSchedulerV2()` 的解构中追加 `oiWatchIntervalMs`，并新增 `safeCallWithResult` 辅助函数

> 注意：`safeCallWithResult` 在现有代码中不存在，必须在 `run-scheduler.ts` 内新增（紧跟现有 `safeCall` 之后）。

```typescript
// ── 新增辅助函数（紧跟现有 safeCall 函数之后）──────────────────────────────
async function safeCallWithResult<T>(
  name: string,
  fn: () => Promise<T>
): Promise<T | undefined> {
  logger.info(`Scheduler: executing ${name}`);
  try {
    const result = await fn();
    logger.info(`Scheduler: ${name} complete`);
    return result;
  } catch (err) {
    logger.error({ err }, `Scheduler: ${name} failed`);
    return undefined;
  }
}
```

在 `runSchedulerV2()` 函数内部，将现有解构追加 `oiWatchIntervalMs`：

```typescript
// runSchedulerV2() 内部 —— 替换现有解构
const {
  scanIntervalMs     = 4 * 60 * 60 * 1000,
  monitorIntervalMs  = 60_000,
  sessionIntervalMs  = 5 * 60 * 1000,
  heartbeatIntervalMs = 30_000,
  oiWatchIntervalMs  = 5 * 60 * 1000, // ← 新增，默认 5min
} = intervals;
```

然后在现有 `timers.push(...)` 之后追加 OI Watch timer：

```typescript
// 在现有四个 timers.push(...) 之后追加
if (config.onOiWatch) {
  timers.push(
    setInterval(async () => {
      if (!signal.aborted && config.onOiWatch) {
        const result = await safeCallWithResult(
          "oi-watch",
          () => config.onOiWatch!(config.scanSymbols)
        );
        // OI 预警触发 → 立即执行完整扫描，不等待下一个 scan 时钟
        if (result?.shouldTriggerScan && !signal.aborted) {
          logger.info("Scheduler: OI 预警触发，执行即时扫描");
          await safeCall("scan-triggered-by-oi", () => config.onScan(config.scanSymbols));
        }
      }
    }, oiWatchIntervalMs)
  );
}
```

**Step 3**: `detect-oi-crash.ts` 新增 2-Sigma 预警函数

```typescript
/**
 * OI 快速预警检测（2-Sigma 级别，比主门控更敏感）
 * 用于 5min 快速轮询，不作为主流水线门控
 */
export function detectOiAlert(
  oiPoints: OpenInterestPoint[],
  lookback = 50,
  alertSigmaThreshold = 2.0 // 比主门控（3.0）更敏感
): { shouldAlert: boolean; alertIndex: number } {
  // 复用现有统计逻辑，只是阈值从 3.0 降至 2.0
  const crashResult = detectOiCrash(oiPoints, undefined, lookback, alertSigmaThreshold);
  return {
    shouldAlert: crashResult.isCrash,
    alertIndex: crashResult.crashIndex,
  };
}
```

#### 验收标准
- [ ] OI 变化率突破 2-Sigma 时，日志显示"OI 预警触发，执行即时扫描"
- [ ] 5min Watch 不影响原有 4h Scan timer 的正常运行
- [ ] `onOiWatch` 未传入时，调度器行为与修改前完全一致

---

### TASK-P2-C：TP 可达性修正（RR 真实化）

**目标文件**: `src/services/consensus/evaluate-consensus.ts`  
**涉及文件（已修正）**:
- `src/services/structure/detect-structural-setups.ts` ← 需扩展返回值
- `src/services/orchestrator/run-signal-scan.ts` ← 需透传 equalLevels
- `src/domain/market/equal-level.ts` ← 已有 `EqualLevel` 类型，直接引用  
**预计工时**: 3.5h（含数据流改造）

#### 物理问题

当前 RR 是纯几何计算，不考虑 TP 路径上的障碍。如果 TP 前方有等高等低阻力区，真实可达的 RR 会大幅低于几何 RR，导致 CVS 高估。

#### 修改方案（含完整数据流）

> **核心约束**：`equalLevels` 数据已在 `analyzeStructuralSetups()` 内部计算，不能重复计算。  
> 必须从结构层向上透传，遵循「数据只算一次」的零冗余原则。

**Step 1**：`detect-structural-setups.ts` 扩展返回值，暴露 `equalLevels`

> **注意**：`EqualLevel` 的 import 在 `detect-structural-setups.ts` **L12 已存在**（`import type { EqualLevel } from "../../domain/market/equal-level.js"`），无需重复添加。直接修改函数返回值类型即可。

```typescript
// detect-structural-setups.ts — 仅需修改返回值类型，import 已存在

// 修改 analyzeStructuralSetups() 返回值类型
export function analyzeStructuralSetups(
  candles4h: Candle[],
  candles1h: Candle[],
  ctx: MarketContext,
  config: StrategyConfig,
  oiPoints: OpenInterestPoint[] = [],
  precomputedEqualLevels?: EqualLevel[],
): {
  setups: StructuralSetup[];
  skipReasonCode?: ReasonCode;
  equalLevels: EqualLevel[]; // ← 新增：透传给 consensus 层复用
} {
  // ...现有逻辑不变...

  // 函数末尾：将 allEqualLevels 一并返回
  if (surviving.length > 0) {
    return { setups: surviving, equalLevels: allEqualLevels }; // ← 新增 equalLevels
  }
  // ...其余 early return 同样补充 equalLevels: allEqualLevels
  return { setups: [], skipReasonCode: "...", equalLevels: allEqualLevels };
}
```

**Step 2**：`ConsensusInput` 新增 `equalLevels` 可选字段

```typescript
// evaluate-consensus.ts 顶部新增 import
import type { EqualLevel } from "../../domain/market/equal-level.js";

// ConsensusInput 扩展（向后兼容，字段为可选）
export type ConsensusInput = {
  symbol: string;
  setups: StructuralSetup[];
  ctx: MarketContext;
  config: StrategyConfig;
  baselineAtr?: number;
  dailyBias?: DailyBias;
  orderFlowBias?: OrderFlowBias;
  equalLevels?: EqualLevel[]; // ← 新增（可选，不传则 TP 可达性跳过）
};
```

**Step 3**：`run-signal-scan.ts` 透传 `equalLevels`

```typescript
// 结构检测返回 equalLevels（Step 1 扩展后）
const structuralAnalysis = analyzeStructuralSetups(candles4h, candles1h, ctx, config, openInterest);

// 共识计算时透传
const consensusAnalysis = analyzeConsensus({
  symbol, setups: structuralAnalysis.setups, ctx, config, baselineAtr,
  dailyBias: dailyBiasResult?.bias, orderFlowBias: orderFlowResult.bias,
  equalLevels: structuralAnalysis.equalLevels, // ← 新增，零重复计算
});
```

**Step 4**：`evaluate-consensus.ts` 新增 `assessTpReachability` 并在循环中使用

```typescript
/**
 * TP 可达性评估
 * 检查从入场区到 TP 路径上是否存在等高等低阻力区
 * @returns multiplier  1.0=畅通 | 0.85=1处阻力 | 0.7=多处阻力
 */
function assessTpReachability(
  setup: StructuralSetup,
  equalLevels: EqualLevel[]
): number {
  // 确定 TP 路径区间（从入场区上沿/下沿 → TP）
  const [pathLow, pathHigh] = setup.direction === "long"
    ? [setup.entryHigh, setup.takeProfitHint]
    : [setup.takeProfitHint, setup.entryLow];

  const obstacles = equalLevels.filter(level => {
    const inPath = level.price >= pathLow && level.price <= pathHigh;
    const notEntry = level.price < setup.entryLow || level.price > setup.entryHigh;
    // 做多：路径上的等高为阻力；做空：路径上的等低为阻力
    const isResistance = setup.direction === "long"
      ? level.type === "high"
      : level.type === "low";
    return inPath && notEntry && isResistance;
  });

  if (obstacles.length === 0) return 1.0;
  if (obstacles.length === 1) return 0.85;
  return 0.7; // >= 2 处阻力
}

// analyzeConsensus() 的 for 循环中（在 computeCVS 之前插入）：
const tpReachability = assessTpReachability(setup, input.equalLevels ?? []);
const adjustedRR = rr * tpReachability; // 修正后的可达 RR
// 注意：此处 computeCVS 的6参数形式依赖 P0-B 先完成（新增 config 参数）。
// 若 P0-B 尚未实施，暂时写 5 参数版本：
// const cvs = computeCVS(setup, regimeAligned, pAligned, adjustedRR, ctx);
const cvs = computeCVS(setup, regimeAligned, pAligned, adjustedRR, ctx, input.config);
```

#### 验收标准
- [ ] `analyzeStructuralSetups` 返回值包含 `equalLevels` 字段，现有调用侧不破坏（`equalLevels` 已存在，只是新增导出）
- [ ] TP 路径上有 1 处等高阻力时，`adjustedRR = 原始RR × 0.85`
- [ ] `input.equalLevels` 未传入时，`assessTpReachability` 返回 `1.0`（无降权）
- [ ] `tsc --noEmit` 零错误

---

## P3 优先级任务（长期，影响系统能力天花板）

### TASK-P3-A：组合方向倾斜度保护

**目标文件**: `src/services/risk/evaluate-exposure-gate.ts`  
**预计工时**: 1h

当组合中同向仓位数量严重超过反向仓位时（如 5 long vs 0 short），新的同向信号即使 CVS 合格也应被降权或阻止，防止极端单边暴露。

```typescript
// config.ts 新增
readonly maxDirectionImbalance: number; // 允许的最大同向/反向仓位数量差（默认 3）

// evaluate-exposure-gate.ts 中
const longCount = openPositions.filter(p => p.direction === "long").length;
const shortCount = openPositions.filter(p => p.direction === "short").length;
const directionImbalance = Math.abs(longCount - shortCount);
const isExtremeSingleSided =
  directionImbalance >= config.maxDirectionImbalance &&
  candidate.direction === (longCount > shortCount ? "long" : "short");

// 若处于极端单边状态，新同向信号需要更高的 CVS 才能通过置换门槛
if (isExtremeSingleSided) {
  // 强制提高置换门槛，或直接返回 block（由 config 开关控制）
}
```

---

### TASK-P3-B：WebSocket 事件驱动调度（架构级升级）

**预计工时**: 8–12h（架构级改造）

从轮询彻底升级到事件驱动：

```
目标架构：
  WebSocket (Bybit/Binance OI Realtime Stream)
    └─ onOiEvent(symbol, oiDelta)
         └─ if |oiDelta| 超 2-Sigma 预警
              └─ 触发 runSignalScan(symbol, ...)
                   └─ 完整 3-Sigma 验证
                        └─ if 通过 → FSD 执行
```

前置条件：完成 TASK-P2-B（5min OI Watch）作为验证基础。

---

### TASK-P3-C：实盘 API 执行引擎

**预计工时**: 12–16h（涉及资金安全）

将 `openPosition(db, ...)` 从纯 SQLite 写入升级为**先调用交易所 API，成功后再落库**。

```typescript
// run-signal-scan.ts FSD 执行阶段
if (config.executionMode === "live") {
  const order = await client.createOrder({ ... });
  if (!order.id) throw new Error("Live order failed");
  openPosition(db, candidate, scannedAt, { ...sizing, exchangeOrderId: order.id });
} else {
  // paper trading（现状不变）
  openPosition(db, candidate, scannedAt, sizing);
}
```

**前置条件**：P0-A、P0-B、P1-A、P2-B 全部完成并通过回测验证。

---

## 执行时间线

```
Week 1（当前周）
  ├── TASK-P0-A: OI 方向性增强          [Day 1–2]
  └── TASK-P0-B: CVS 滑点摩擦力         [Day 2–3]

Week 2
  ├── TASK-P1-A: Sweep 非线性评分       [Day 1]
  ├── TASK-P1-B: CSP 动态置换门槛       [Day 1–2]
  └── TASK-P1-C: CVD 加速度接入         [Day 3–5]

Week 3
  ├── TASK-P2-A: 信号半衰期衰减         [Day 1–2]
  ├── TASK-P2-B: OI 快速监控调度        [Day 2–4]
  └── TASK-P2-C: TP 可达性修正          [Day 4–5]

Month 2
  ├── TASK-P3-A: 组合方向倾斜度保护     [Week 1]
  ├── TASK-P3-B: WebSocket 事件驱动     [Week 2–3]
  └── TASK-P3-C: 实盘 API 执行引擎      [Week 4]（需充分回测验证）
```

---

## 质量门槛（每个任务必须通过）

1. **单元测试覆盖率**：新增代码 ≥ 90% 覆盖率
2. **向后兼容性**：新参数均提供默认值，不破坏现有调用侧
3. **TypeScript 严格类型**：`tsc --noEmit` 零错误
4. **物理诚实性校验**：每个修改必须能用第一性原理语言描述其物理意义
5. **回测验证**（P3 前）：在历史数据上对比修改前后的信号质量指标

---

## 关键设计约束（延续 v2.0 零容忍清单）

```
✅ 所有新增逻辑必须基于可量化的物理量（价格、OI、CVD、ATR）
✅ 新增参数必须有物理意义的默认值，并在 config.ts 有注释说明
❌ 严禁引入基于"叙事"或"情绪"的任何过滤逻辑
❌ 严禁硬编码魔法数字（阈值必须进入 StrategyConfig）
❌ 严禁在扫描关键路径引入 > 100ms 的外部同步调用
❌ P3-C（实盘接入）完成前，严禁在生产环境启用 executionMode = "live"
```

---

> **"任何公司停止改进的那一刻就开始死亡了。"**  
> 本计划的目标是让每一行代码都能用物理语言解释其存在意义。  
> 从 P0 开始，逐步消除感应层的盲点、决策层的残缺和执行层的延迟。🚀

---

## 📋 复核勘误（v1.1 — 2026-03-24）

> 本节记录对照真实代码库进行逐行验证后发现的错误，以及对应的修正方案。  
> **执行时必须以本节修正为准，原文描述若与本节冲突，以本节为准。**

---

### 勘误 #1 — TASK-P0-A：`closePrices` 序列长度与 `oiPoints` 不匹配

**问题位置**: Step 2 & Step 4

**错误描述**:  
原文建议 `detectOiCrash(oiPoints, candles4h.map(c => c.close))` 传入完整的 4h K 线收盘价序列。  
但 `candles4h` 默认有 500 根，而 `oiPoints` 只有 50 个点——两者时间粒度和长度完全不匹配，直接传入会导致价格方向判断错误（取 `closePrices.slice(-2)` 会是最近2根4h K线，而非最近2个OI数据点对应的时段）。

**修正方案**:  
`detectOiCrash()` 内部仅需最近 2 个收盘价判断价格方向，与 oiPoints 长度无关。  
函数签名注释改为：

```typescript
// closePrices 不要求与 oiPoints 等长
// 函数内部只取 closePrices.slice(-2) 判断最近价格方向
// 调用方直接传 candles4h.map(c => c.close) 即可（取最近2根）
export function detectOiCrash(
  oiPoints: OpenInterestPoint[],
  closePrices?: number[], // ← 仅需最近 ≥ 2 个收盘价，无需与 oiPoints 等长
  lookback = 50,
  sigmaThreshold = 3.0
): OiCrashResult
```

这在逻辑上是正确的，原代码 `closePrices.slice(-2)` 已按此逻辑处理——**只需在代码注释中明确说明**，避免调用者误以为需要对齐长度后再传入。

---

### 勘误 #2 — TASK-P0-A：看涨/看跌 Sweep 方向评注有笔误

**问题位置**: Step 3，`OI↓ + Price↑` 的注释

**错误描述**:  
原文注释写：`OI↓ + Price↑ → 空头被清算 → 支持看跌 Sweep`  
这里"支持看跌 Sweep"表述有歧义。物理现实是：  
- OI↓ + Price↑ = 空头被强平（short squeeze），价格被从下往上扫过，**是看涨结构后的看跌回归**  
- 但这种场景下，若存在看涨 Sweep（扫低后收回），其对手方清算机制是 `long_liquidation`

**修正**:  
`mechanismType` 与 Sweep 信号方向的对应关系如下（此为最终正确版本）：

| `mechanismType` | Sweep 方向 | 物理解释 | 评分调整 |
|---|---|---|---|
| `long_liquidation`（OI↓+Price↓）| **看涨 Sweep** | 多头被强平 → 低点被扫 → 反弹 | +5（吻合）|
| `long_liquidation`（OI↓+Price↓）| 看跌 Sweep | 与清算方向不吻合 | -15（惩罚）|
| `short_squeeze`（OI↓+Price↑）| **看跌 Sweep** | 空头被逼空 → 高点被扫 → 回落 | +5（吻合）|
| `short_squeeze`（OI↓+Price↑）| 看涨 Sweep | 与清算方向不吻合 | -15（惩罚）|
| `mixed_deleveraging` | 任意方向 | 双向排毒，方向模糊 | -10（全局降权）|

原文 Step 3 代码逻辑本身是正确的，只是 `OiLiquidationMechanism` 的枚举注释有误导，按上表理解即可。

---

### 勘误 #3 — TASK-P1-B：`regimeDecision` 变量无需单独传递

**问题位置**: Step 4

**错误描述**:  
原文写：
```typescript
regimeConfidence: regimeDecision.confidence, // 新增
```

但在 `run-signal-scan.ts` 中，`regimeDecision` 是 `detectMarketRegime()` 的返回值，其 `confidence` 已被 `buildMarketContext()` 映射到 `ctx.regimeConfidence`（见 `build-market-context.ts` L29）。  
因此无需再引用 `regimeDecision` 变量，直接从 `ctx` 获取即可，代码更简洁。

**修正方案**：Step 4 改为：

```typescript
const swappingDecision = evaluateSwappingGate({
  candidate,
  openPositions,
  portfolioOpenRiskPercent: portfolioExposure.openRiskPercent,
  config,
  currentRegime: ctx.regime,          // 从 ctx 获取（不需要 regimeDecision）
  regimeConfidence: ctx.regimeConfidence, // ← 修正：从 ctx.regimeConfidence 获取
});
```

同时 `ExposureGateInput` 的新字段类型直接使用 `MarketRegime`（已从 `src/domain/regime/market-regime.ts` 导出），无需新增 import：

```typescript
import type { MarketRegime } from "../../domain/regime/market-regime.js";

export type ExposureGateInput = {
  // ...现有字段...
  currentRegime?: MarketRegime;    // 使用已有的 MarketRegime 联合类型
  regimeConfidence?: number;
};
```

---

### 勘误 #4 — TASK-P2-A：`weakestPosition.openedAt` 字段确认存在但需注意

**问题位置**: 衰减函数调用侧

**验证结论**:  
经核查 `src/domain/position/open-position.ts` L39 和 `src/services/positions/track-position.ts` L135，`OpenPosition.openedAt` 字段**确实存在**，映射自 `row.opened_at`。  

**无需修改**，但需补充以下调用说明（原文缺失）：

`applySignalDecay` 的调用位置是 **`evaluate-exposure-gate.ts`** 中的置换比较逻辑，需从 evaluate-consensus 导入该函数：

```typescript
// evaluate-exposure-gate.ts 顶部新增 import
import { applySignalDecay } from "../consensus/evaluate-consensus.js";

// 置换比较时使用衰减后的分数
const positionAge = Date.now() - weakestPosition.openedAt; // openedAt 存在 ✅
const decayedPositionCvs = applySignalDecay(
  weakestPosition.capitalVelocityScore,
  positionAge
);

// SWAP_THRESHOLD 比较使用 decayedPositionCvs
if (candidate.capitalVelocityScore > decayedPositionCvs * SWAP_THRESHOLD_RATIO) {
  // 触发置换
}
```

---

### 勘误 #5 — TASK-P2-B：`safeCallWithResult` 函数不存在

**问题位置**: Step 2，`runSchedulerV2()` 新增 OI Watch timer

**错误描述**:  
原文使用了 `safeCallWithResult("oi-watch", ...)` 函数，但该函数在 `run-scheduler.ts` 中**不存在**。  
现有的 `safeCall()` 返回 `Promise<void>`，无法传递回调结果。

**修正方案**：新增内部辅助函数 `safeCallWithResult`，或直接在 OI Watch timer 内联实现：

```typescript
// run-scheduler.ts 内部辅助函数（新增，紧跟现有 safeCall 之后）
async function safeCallWithResult<T>(
  name: string,
  fn: () => Promise<T>
): Promise<T | undefined> {
  logger.info(`Scheduler: executing ${name}`);
  try {
    const result = await fn();
    logger.info(`Scheduler: ${name} complete`);
    return result;
  } catch (err) {
    logger.error({ err }, `Scheduler: ${name} failed`);
    return undefined;
  }
}
```

同时，`oiWatchIntervalMs` 变量在 Step 2 原文中直接使用但**未从 `intervals` 解构**。需补充解构步骤：

```typescript
// runSchedulerV2() 函数内部，在现有解构之后追加
const {
  scanIntervalMs = 4 * 60 * 60 * 1000,
  monitorIntervalMs = 60_000,
  sessionIntervalMs = 5 * 60 * 1000,
  heartbeatIntervalMs = 30_000,
  oiWatchIntervalMs = 5 * 60 * 1000,  // ← 新增解构（默认 5min）
} = intervals;
```

---

### 勘误 #6 — TASK-P2-C：`ConsensusInput` 没有 `equalLevels` 字段

**问题位置**: `analyzeConsensus()` 调用侧与 `assessTpReachability` 入参

**错误描述**:  
原文写 `assessTpReachability(setup, input.equalLevels ?? [])` ——但查看 `evaluate-consensus.ts` L14-22，`ConsensusInput` 类型**不包含 `equalLevels` 字段**：

```typescript
// 当前 ConsensusInput（无 equalLevels）
export type ConsensusInput = {
  symbol: string;
  setups: StructuralSetup[];
  ctx: MarketContext;
  config: StrategyConfig;
  baselineAtr?: number;
  dailyBias?: DailyBias;
  orderFlowBias?: OrderFlowBias;
  // ← 没有 equalLevels
};
```

**修正方案**：在 `ConsensusInput` 中新增可选字段（并在 `run-signal-scan.ts` 调用时传入）：

```typescript
// evaluate-consensus.ts 中扩展 ConsensusInput
import type { EqualLevel } from "../../domain/market/equal-level.js"; // 新增 import

export type ConsensusInput = {
  symbol: string;
  setups: StructuralSetup[];
  ctx: MarketContext;
  config: StrategyConfig;
  baselineAtr?: number;
  dailyBias?: DailyBias;
  orderFlowBias?: OrderFlowBias;
  equalLevels?: EqualLevel[]; // ← 新增（可选，向后兼容）
};
```

`run-signal-scan.ts` 调用侧需要将等高等低数据传入。但当前 `run-signal-scan.ts` 的主流水线**没有独立计算 `equalLevels`**——等高等低计算发生在 `analyzeStructuralSetups()` 内部，不对外暴露。

因此需要额外选择实现路径：

**方案 A（推荐）**：`analyzeStructuralSetups()` 在返回值中追加 `equalLevels` 字段，供 consensus 层复用：

```typescript
// detect-structural-setups.ts 返回值类型扩展
export function analyzeStructuralSetups(...): {
  setups: StructuralSetup[];
  skipReasonCode?: ReasonCode;
  equalLevels?: EqualLevel[]; // ← 新增
}
// 在函数末尾返回 { setups: surviving, equalLevels: allEqualLevels }
```

**方案 B**：在 `run-signal-scan.ts` 中独立调用 `detectEqualHighs` + `detectEqualLows`，然后传给 consensus。代码冗余但不需改动结构层。

> 推荐方案 A，符合"数据只算一次"的零冗余原则。

---

### 勘误 #7 — TASK-P1-C：`computeCvdAcceleration` 中 `approxDelta` 需要 import

**问题位置**: Step 1，`compute-cvd.ts` 新增函数

**说明**:  
`approxDelta` 已在 `compute-cvd.ts` 中定义（L27），新增的 `computeCvdAcceleration` 函数在**同一文件**中，可直接调用，**无需额外 import**。原文代码是正确的，但为避免实现时误将此函数放到其他文件，特此说明：

> `computeCvdAcceleration` 必须定义在 `src/services/analysis/compute-cvd.ts` 文件内，紧跟 `detectOrderFlowBias` 之后。

---

### 复核总结

| 编号 | 任务 | 问题类型 | 严重度 | 状态 |
|------|------|---------|-------|------|
| #1 | P0-A | 参数对齐误解（注释说明问题，逻辑实际无误）| 低 | ✅ 已澄清 |
| #2 | P0-A | 注释歧义（方向对应表述不准确）| 低 | ✅ 已给出正确对应表 |
| #3 | P1-B | 引用了可从 `ctx` 直接获取的变量 | 低 | ✅ 已简化 |
| #4 | P2-A | 缺少 import 说明和完整调用链 | 低 | ✅ 已补充 |
| #5 | P2-B | **引用了不存在的函数 `safeCallWithResult`，且缺少变量解构步骤** | **高** | ✅ 已给出完整实现 |
| #6 | P2-C | **`ConsensusInput` 无 `equalLevels` 字段，需扩展类型并修改数据流** | **高** | ✅ 已给出两种方案，推荐方案 A |
| #7 | P1-C | `approxDelta` 的作用域说明缺失（防止误放错文件）| 低 | ✅ 已说明 |

> **实施前必须先阅读本「复核勘误」章节。执行 P2-B 时必须先实现 `safeCallWithResult`；执行 P2-C 时必须先扩展 `analyzeStructuralSetups` 返回值并同步修改 `ConsensusInput`。**

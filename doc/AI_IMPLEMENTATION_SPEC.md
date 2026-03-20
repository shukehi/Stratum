# Stratum AI 实现规格

## 1. 文档目标

本文档用于指导 AI 编程助手基于 [stratum-master-architecture.md](/Users/aries/Dve/crypto/Stratum/doc/stratum-master-architecture.md) 实现 Stratum 项目。

本规格不是新的架构文档，而是把主文档转化为 AI 更容易执行的开发说明，包括：

- 开发顺序
- 模块任务拆分
- 输入输出约束
- 编码边界
- 最低验收标准

## 2. 总体要求

AI 在实现前必须先阅读主文档 §3A（第一性原理的因果推导），理解以下因果链：

- 价格大幅运动由被迫交易驱动（保证金追缴、止损瀑布、清算级联），而非图形出现
- 市场状态决定参与者行为的含义（同一信号在不同状态下后果不同）
- 结构层回答”在哪里”，参与者层回答”为什么”，两者不可混淆
- LLM 做因果链的外围校验，不参与因果链的构建

AI 在实现时必须遵守以下原则：

1. 先实现环境与参与者逻辑，再实现结构信号。
2. 不允许跳过市场状态层直接做 FVG 驱动系统。
3. 不允许让 LLM 输出参与交易执行决策。
4. 所有核心判断逻辑必须写成可测试的纯函数或近纯函数。
5. 所有阈值必须收敛到配置层，不得散落在业务代码中。
6. 所有外部依赖都必须经过 `clients` 层封装。
7. 任何模块实现不完整时，优先返回”跳过信号”而不是伪造交易判断。
8. 不允许在下游模块中把带 `confidence` 和 `reasons` 的判定对象压缩成单个枚举后再继续传递。
9. 不允许自由生成开放文本理由而不附带结构化 `reasonCodes`。
10. LLM Prompt 构造必须遵循主文档 §14.1 规范，禁止向 LLM 暴露因果链内部判断数据。

## 3. 目标代码结构

AI 必须按如下目录实现，除非后续有人类明确修改：

```text
src/
  app/
  clients/
  domain/
  services/
  repositories/
  db/
  workflows/
  utils/
test/
  unit/
  integration/
  fixtures/
```

## 4. 开发阶段顺序

必须按以下顺序开发，不得先做后面的高级模块再补前面的基础层。

### 阶段 1：项目基础设施

目标：

- 初始化 Node.js + TypeScript 项目
- 配置 lint、格式化、测试框架
- 建立 `src` 和 `test` 目录
- 建立环境变量读取与配置系统
- 建立基础日志模块

交付物：

- `package.json`
- `tsconfig.json`
- `src/app/env.ts`
- `src/app/config.ts`
- `src/app/logger.ts`
- 基础测试可运行

验收标准：

- `npm test` 或 `pnpm test` 可执行
- 环境变量读取失败时能给出清晰错误
- 配置项集中管理

### 阶段 2：领域模型与客户端接口

目标：

- 定义领域类型
- 定义交易所、新闻、LLM、Telegram 客户端接口
- 暂不实现复杂业务逻辑

最低需要的领域模型：

- `Candle`
- `FundingRatePoint`
- `OpenInterestPoint`
- `NewsItem`
- `MarketRegime`
- `ReasonCode`
- `RegimeDecision`
- `ParticipantPressure`（含 `spotPerpBasis`、`basisDivergence`）
- `MarketContext`（含 `liquiditySession`、`spotPerpBasis`、`basisDivergence`）
- `LiquiditySession`
- `StructuralSetup`（含 `confluenceFactors`、`confirmationStatus`、`confirmationTimeframe`）
- `ConfluenceFactor`
- `MacroAssessment`
- `MacroOverlayDecision`
- `TradeCandidate`

验收标准：

- 类型定义清晰
- 无循环依赖
- `clients` 仅暴露接口与基础实现骨架

### 阶段 3：市场数据管道

目标：

- 接入 `ccxt`
- 获取 `OHLCV`
- 获取资金费率
- 获取未平仓量
- 获取现货价格（用于计算现货-永续基差）
- 标准化为领域模型

实现约束：

- 不在客户端层做策略判断
- 统一时间戳格式
- 对空数据和接口失败做显式处理
- `ExchangeClient` 必须实现 `fetchSpotTicker()` 方法
- 若交易所不支持独立现货 ticker，使用同交易所现货交易对的 `fetchTicker` 替代
- 若现货数据暂时不可用，默认返回 `{ last: 0 }`，下游以 `spotPerpBasis = 0` 处理

验收标准：

- 能成功获取并返回标准化数据（含现货 ticker）
- 对异常情况有可预期错误或空结果
- 有基础集成测试或 fixture 测试

### 阶段 4：市场状态识别

目标：

- 实现 `detectMarketRegime()`
- 输出 `regime`、`confidence` 和 `reasons`

输入：

- `4h` K 线
- `1h` K 线
- 可选的最近新闻项，用于识别突发事件驱动环境

输出：

```ts
type RegimeDecision = {
  regime: "trend" | "range" | "event-driven" | "high-volatility";
  confidence: number;
  reasons: string[];
  reasonCodes: ReasonCode[];
};
```

实现要求：

- 使用评分制，不要只写单个 `if/else`
- 将窗口长度和阈值放入配置
- 若无法明确识别，输出低置信度结果
- MVP 中 `event-driven` 必须仅依赖价格异常波动和最近新闻提示实现，不得假设经济日历数据已存在
- 趋势评分必须包含“衰竭惩罚”，避免把末端加速误判为更强趋势
- 最终状态选择必须遵守固定优先级：`event-driven` 覆盖 `high-volatility`，`high-volatility` 覆盖 `trend/range`
- 若最高分与次高分差值低于 `minRegimeScoreGap`，必须降低置信度并附加 `REGIME_AMBIGUOUS`

验收标准：

- 至少有趋势样本、震荡样本、高波动样本测试
- 至少有一个由异常波动或突发新闻触发的 `event-driven` 样本测试
- 至少有一个“延伸过度但不应继续抬高 trend 置信度”的样本测试
- 测试中能解释为什么进入某个 regime

### 阶段 5：参与者压力分析

目标：

- 实现 `assessParticipantPressure()`
- 基于 funding、OI、价格关系和现货-永续基差判断仓位拥挤

输入：

- 资金费率序列
- 未平仓量序列
- 对应价格序列
- 现货价格（`spotPrice`）
- 永续合约价格（`perpPrice`）

输出：

```ts
type ParticipantPressure = {
  bias: “long-crowded” | “short-crowded” | “balanced”;
  pressureType: “squeeze-risk” | “flush-risk” | “none”;
  confidence: number;
  rationale: string;
  spotPerpBasis: number;
  basisDivergence: boolean;
  reasonCodes: ReasonCode[];
};
```

实现要求：

- 必须区分”新开仓推动”和”平仓驱动”
- 必须允许输出 `balanced`
- 不得把所有上涨 + OI 上升都简单等价为做多信号
- 若 `1h` OI 绝对降幅超过真空阈值，默认输出 `pressureType: “none”`
- 必须保留可识别的”去杠杆真空”标记，便于共识层单独跳过
- 必须计算 `spotPerpBasis = (spotPrice - perpPrice) / spotPrice`
- 当 `|spotPerpBasis| >= basisDivergenceThreshold` 且基差方向与 funding rate 方向相反时，标记 `basisDivergence = true`
- `basisDivergence = true` 时，对应方向的 `pressureType` 置信度上调 `basisDivergenceConfidenceBoost`（默认 `12` 分）
- 若现货数据不可用（`spotPrice = 0`），`spotPerpBasis` 默认为 `0`，`basisDivergence` 默认为 `false`

验收标准：

- 至少覆盖 4 类测试样本：
  - 价格涨 + OI 涨
  - 价格跌 + OI 涨
  - 价格涨 + OI 跌
  - 价格跌 + OI 跌
- 至少有一个”价格急跌 + OI 绝对大幅下降 -> 视为去杠杆真空”的样本测试
- 至少有一个”funding 负值 + 现货溢价 -> squeeze-risk 置信度上调”的基差背离测试
- 至少有一个”funding 正值 + 期货溢价 -> flush-risk 置信度上调”的基差背离测试
- 每类样本都有清晰断言

补充要求：

- 在进入阶段 7 前，必须把 `RegimeDecision` 和 `ParticipantPressure` 组合为 `MarketContext`
- `MarketContext` 不得丢失 `regimeConfidence`、`regimeReasons`、`participantConfidence`、`participantRationale`、`spotPerpBasis`、`basisDivergence` 和 `liquiditySession`
- `RegimeDecision`、`ParticipantPressure` 和 `MarketContext` 都必须包含结构化 `reasonCodes`

### 阶段 6：结构触发识别

目标：

- 实现 `detectFvg()`
- 实现前高前低或基础流动性池检测
- 实现 `detectConfluence()`（复合结构检测）
- 实现 `confirmEntry()`（入场区域确认）
- 实现 `detectStructuralSetups()`
- 实现交易时段流动性修正

输入：

- `MarketContext`（含 `liquiditySession`）
- `4h` 和 `1h` K 线
- 当前价格

输出：

- `StructuralSetup[]`（含 `confluenceFactors`、`confirmationStatus`）

实现要求：

- 结构层只允许在 `regimeConfidence >= minRegimeConfidence` 且不存在 `DELEVERAGING_VACUUM` 时运行
- 结构层只返回介入区域、失效边界和目标提示
- 不在此层做最终交易决策
- 必须允许无信号输出
- 对基于前高前低流动性池的 setup，必须使用收盘确认，禁止首次触碰即触发
- 每个 `StructuralSetup` 必须包含 `structureScore`、`reasonCodes`、`confluenceFactors`、`confirmationStatus`
- 结构层不得输出最终仓位、最终等级或宏观结论
- **复合结构规则**：当多种结构类型在同一价格区域重叠时，`structureScore` 加 `confluenceBonus`（默认 `10` 分）；3 种及以上叠加加 `confluenceBonus × 1.5`；流动性 sweep 后同区域出现 FVG 加 `confluenceBonus × 2`
- **入场确认规则**：初始状态为 `pending`，做多方向需要 `1h` K 线下影线占比 `>= confirmationShadowRatio` 或连续 `confirmationCandles` 根不创新低；做空对称；`1h` 收盘穿透 `stopLossHint` 则变为 `invalidated`
- **时段修正规则**：`asian_low` 时段 `structureScore` 乘以 `sessionDiscountFactor`（默认 `0.8`）；`london_ramp` 时段乘以 `sessionPremiumFactor`（默认 `1.1`）

验收标准：

- FVG 检测有单元测试
- 结构结果包含方向、入场区、止损提示、目标提示、`confluenceFactors`、`confirmationStatus`
- 不在无效环境下强行构造 setup
- 至少有一个”刺破前低但 `4h` 收回 -> 有效 sweep”和一个”刺破后未收回 -> 无效 sweep”的测试
- 至少有一个”FVG + 流动性池重叠 -> confluenceFactors 包含两项且 structureScore 加分”的测试
- 至少有一个”价格进入区域 + 1h 出现长下影线 -> confirmed”的测试
- 至少有一个”价格进入区域 + 1h 收盘穿透止损 -> invalidated”的测试
- 至少有一个”asian_low 时段 structureScore 被折扣”的测试

### 阶段 7：风险与共识引擎

目标：

- 实现 `computeRiskReward()`
- 实现 `computePositionSize()`
- 实现 `evaluateConsensus()`

输入：

- `MarketContext`
- `StructuralSetup[]`

输出：

- `TradeCandidate[]`

实现要求：

- 必须先检查 `regime`
- 必须检查 `regimeConfidence`
- 必须检查 `participantConfidence`
- 必须检查 `structureScore`
- 必须检查最小风险回报比（阈值推导见主文档 §15.0）
- 必须把”极端 OI 去杠杆真空”作为默认跳过条件
- 必须检查 `confirmationStatus`：只有 `confirmed` 状态的 setup 才能进入共识层
- `pending` 状态的 setup 可输出为 `watch` 级别预警，但不参与正式信号评级
- 若条件不足，应返回空数组

验收标准：

- 低风险回报 setup 被过滤
- 状态不匹配 setup 被过滤
- 参与者压力反向冲突 setup 被过滤
- `structureScore < minStructureScore` 的 setup 被过滤
- `confirmationStatus !== “confirmed”` 的 setup 不产生 `standard` 或 `high-conviction` 信号

### 阶段 8：语义层与 LLM 护栏

目标：

- 实现新闻抓取接口
- 实现 Prompt 构造（见主文档 §14.1）
- 实现 `zod` 校验和重试
- 实现可选的语义过滤
- 实现 `applyOverlayDecision()` 合并逻辑（见主文档 §14.3）

语义层输出：

```ts
type MacroOverlayDecision = {
  action: "pass" | "downgrade" | "block";
  confidence: number;
  reason: string;
  reasonCodes: ReasonCode[];
};
```

实现要求：

- LLM 只能返回 JSON
- 校验失败时重试
- 三次失败后跳过语义层，不阻断主流程
- 不允许 LLM 决定入场位、止损、止盈或仓位
- 语义层只能 `pass`、`downgrade` 或 `block`
- 语义层不能把低等级信号提升为更高等级

Prompt 构造约束（详见主文档 §14.1）：

- 必须传入：最近 `maxNewsItemsForPrompt`（默认 `10`）条新闻、当前价格、候选方向和等级、`contextReason`
- 禁止传入：`structureScore`、`stopLoss`/`takeProfit` 具体价格、`participantConfidence`、`confluenceFactors`、原始 K 线或 OI 数据
- Prompt 必须显式包含约束指令，告知 LLM 只能输出 pass/downgrade/block，不能建议方向或位置

block / downgrade / pass 判定标准（详见主文档 §14.2）：

- `block`：未来 4h 内有重大宏观事件、突发监管风险、基本面直接矛盾
- `downgrade`：轻微矛盾、远期利空、过度一致性风险
- `pass`：无关或一致新闻、无高影响事件

降级幅度规则（详见主文档 §14.3）：

- `downgrade` 降低一级（`high-conviction → standard`，`standard → watch`，`watch → watch`）
- `block` 的信号仍写入数据库（`alert_status = "blocked_by_macro"`），不发告警
- `pass` 的信号保持原等级，`catalystSummary` 附加到告警文案

验收标准：

- 有非法 JSON 响应测试
- 有重试逻辑测试
- 有成功解析测试
- 有 `downgrade` 和 `block` 行为测试
- 有 Prompt 构造测试：验证 `structureScore`、`stopLoss`、`participantConfidence` 不在 prompt 中
- 有降级幅度测试：`high-conviction` 被 `downgrade` 后变为 `standard`，`standard` 变为 `watch`
- 有 `block` 落库测试：被 block 的信号仍写入数据库且 `alert_status = "blocked_by_macro"`

### 阶段 9：告警与持久化

目标：

- 实现 Telegram 告警构造
- 实现 SQLite 表结构
- 记录市场上下文、语义评估和交易信号
- 为信号记录告警分发状态

最低持久化范围：

- `candles`
- `funding_rate_points`
- `open_interest_points`
- `news_items`
- `macro_assessments`
- `market_contexts`
- `signals`

验收标准：

- 告警文案包含状态、参与者、结构、风险信息
- 发送前信号已落库
- 发送失败时仅更新告警状态，不丢失信号
- 数据库 schema 与领域模型一致

### 阶段 10：工作流与调度

目标：

- 实现 `runAnalysisCycle()`
- 实现 `runBackfill()`
- 实现 `runPaperTradeReview()`
- 实现 `runCalibrationReview()`

要求：

- 工作流按主文档顺序编排
- 不允许跳过状态层和参与者层
- 工作流必须记录关键日志
- 工作流必须先持久化，再尝试发送告警，再回写分发结果
- `runAnalysisCycle()` 必须在数据拉取阶段获取现货价格，并传入参与者压力分析
- `runAnalysisCycle()` 必须在结构扫描前计算当前流动性时段
- `runCalibrationReview()` 在已关闭信号达到 `calibrationMinSampleSize` 后可运行，按 regime / structureScore / 时段 / confluence 维度生成校准报告
- `runCalibrationReview()` 不得自动修改配置，只输出 JSON 报告和 Telegram 摘要

验收标准：

- 单次分析周期可从拉数到落库完整跑通
- 失败模块有清晰日志
- 校准工作流在样本不足时输出"样本不足"状态而非空报告

## 5. 关键实现边界

AI 在实现过程中必须遵守这些边界：

### 5.1 不允许的实现

- 不允许直接从新闻结论生成做多做空信号
- 不允许让 FVG 单独生成最终交易决策
- 不允许把策略阈值硬编码在多个文件里
- 不允许把数据库写操作散落在服务层逻辑中
- 不允许为了“先跑通”而跳过空结果和失败处理

### 5.2 鼓励的实现

- 优先使用纯函数
- 为每个核心模块写独立测试
- 在返回结果中附带 `reasons` 或 `rationale`
- 将所有评分和阈值统一收口到配置

## 6. 默认配置约束

AI 默认实现时可使用以下初始配置，除非文档另有明确要求：

```ts
export const strategyConfig = {
  // --- 周期与数据 ---
  primaryTimeframe: "4h",
  secondaryTimeframe: "1h",
  marketDataLimit: 500,

  // --- 风险回报（推导见主文档 §15.0）---
  minimumRiskReward: 2.5,
  riskPerTrade: 0.01,

  // --- 市场状态 ---
  minRegimeConfidence: 60,
  eventDrivenOverrideScore: 80,
  highVolatilityOverrideScore: 75,
  minRegimeScoreGap: 10,
  trendExtensionAtrPenaltyThreshold: 2.0,

  // --- 参与者压力 ---
  minParticipantConfidence: 60,
  oiCollapseVacuumThresholdPercent: 0.1,
  basisDivergenceThreshold: 0.002,
  basisDivergenceConfidenceBoost: 12,

  // --- 结构触发 ---
  liquiditySweepConfirmationTimeframe: "4h",
  minStructureScore: 60,
  minStructureScoreForWeakParticipantOverride: 75,
  confluenceBonus: 10,
  confirmationShadowRatio: 0.5,
  confirmationCandles: 2,

  // --- 交易时段 ---
  enableSessionAdjustment: true,
  sessionDiscountFactor: 0.8,
  sessionPremiumFactor: 1.1,

  // --- 风控门槛 ---
  maxStopDistanceAtr: 2.5,
  maxCorrelatedSignalsPerDirection: 2,

  // --- 事件与语义 ---
  recentEventWatchWindowHours: 12,
  minimumMacroConfidence: 7,
  minimumBtcRelevance: 6,
  allowEventDrivenSignals: false,
  maxNewsItemsForPrompt: 10,

  // --- 校准 ---
  calibrationMinSampleSize: 50,
};
```

## 7. 默认跳过规则

若以下任一条件成立，AI 实现的共识引擎默认应返回空信号：

- `regime.confidence < minRegimeConfidence`
- 当前是 `event-driven` 且 `allowEventDrivenSignals = false`
- `participantPressure.confidence < minParticipantConfidence` 且 `structureScore < minStructureScoreForWeakParticipantOverride`
- 最近 `1h` OI 绝对降幅超过 `oiCollapseVacuumThresholdPercent`
- `structureScore < minStructureScore`
- `confirmationStatus === "invalidated"`
- `sameDirectionOpenSignals > maxCorrelatedSignalsPerDirection`
- `stopDistanceAtr > maxStopDistanceAtr`
- `riskReward < minimumRiskReward`
- 缺失必要价格或市场数据

额外约束：

- `confirmationStatus === "pending"` 的 setup 不返回空信号，但 `signalGrade` 强制为 `watch`

## 8. 测试最低覆盖要求

AI 至少应提供以下测试：

### 8.1 单元测试

- 市场状态识别测试
- 参与者压力测试（含现货-永续基差背离场景）
- FVG 检测测试
- 复合结构（confluence）检测与评分测试
- 入场确认机制测试（confirmed / pending / invalidated 三种状态）
- 交易时段流动性修正测试
- 风险回报计算测试
- 仓位计算测试
- LLM Schema 校验测试
- 共识引擎过滤测试（含 confirmationStatus 过滤）
- Prompt 构造测试：验证禁止传入的字段不在 prompt 中
- 降级幅度测试：`high-conviction → standard`，`standard → watch`
- `block` 落库测试：被 block 的信号仍写入数据库且 `alert_status = "blocked_by_macro"`

### 8.2 集成测试

- 交易所客户端数据标准化测试（含现货 ticker）
- 工作流主路径测试

## 9. AI 开发时的行为要求

AI 开发时必须遵守以下行为逻辑：

1. 若文档中存在未量化细节，应优先做保守实现。
2. 若无法确定某个规则，应实现为可配置项，而不是擅自固定。
3. 若某模块缺少数据，不应伪造结果，应显式跳过。
4. 若实现存在多个合理方案，应选择最简单、最可测试、最可解释的方案。

## 10. 最终判断标准

只有当以下条件都满足时，才算 AI 基本按文档完成开发：

1. 主流程顺序与主文档一致
2. 市场状态层与参与者层先于结构层执行
3. 参与者压力层包含现货-永续基差背离检测
4. 结构层包含复合结构检测和入场确认机制
5. 结构评分包含交易时段流动性修正
6. LLM 未进入核心决策路径
7. 风控过滤为硬门槛，RR 阈值有明确的胜率推导锚点
8. 无信号是合法输出
9. 核心逻辑均有测试覆盖
10. 存在参数校准工作流（只输出建议，不自动修改配置）
11. LLM Prompt 不包含因果链内部判断数据（structureScore、participantConfidence 等）
12. LLM block/downgrade/pass 有明确判定标准，降级幅度为一级
13. 被 block 的信号仍写入数据库，不丢失研究样本

## 11. 结论

本规格的目的，不是让 AI 自由发挥交易系统，而是把 AI 限制在第一性原理定义好的轨道内施工。

只要 AI 严格按本文件和主架构文档实施，它就可以开发出一个结构清晰、边界合理、接近第一性原理波段交易逻辑的 MVP。

实施完成后，使用 [EVALUATION_CRITERIA.md](./EVALUATION_CRITERIA.md) 中的三层十六问和十条红线规则，持续验证系统是否真正遵循了第一性原理。

# Phase 30: Mechanism Regime Refactor

## 1. 目标

重构状态层，使其从“价格行为分类”升级为“市场驱动机制分类”。

本阶段要解决的问题不是把 regime 名字改得更复杂，而是让状态层真正回答：

- 当前是谁在推动价格
- 这个推动来自新开仓、平仓，还是去杠杆真空
- 当前环境是否适合结构层继续寻找机会

## 2. 前置依赖

- 当前 `PHASE_03_REGIME_ENGINE`
- 当前 `PHASE_04_PARTICIPANT_PRESSURE`
- [OPTIMIZATION_PLAN.md](/Users/aries/Dve/crypto/Stratum/doc/OPTIMIZATION_PLAN.md)

## 3. 允许修改范围

- `src/services/regime/*`
- `src/services/participants/*`
- `src/domain/regime/*`
- `src/domain/market/*`
- `src/domain/common/*`
- `src/app/config.ts`
- `src/services/orchestrator/run-signal-scan.ts`
- `test/unit/regime/*`
- `test/unit/participants/*`
- `test/unit/orchestrator/*`

## 4. 交付物

- 机制驱动的 `detectMarketRegime()`
- 扩展后的 `RegimeDecision` 或等价输出对象
- 明确的 `driverType`
- 新的 `ReasonCode`

## 5. 任务清单

1. 为状态层增加“市场驱动机制”表达能力。
2. 将以下输入纳入状态层判断：
   - 价格变化
   - OI 变化
   - funding 方向
   - spot/perp basis
   - 去杠杆真空状态
3. 明确区分至少以下驱动类型：
   - `new-longs`
   - `new-shorts`
   - `short-covering`
   - `long-liquidation`
   - `deleveraging-vacuum`
   - `unclear`
4. 将价格行为相关特征保留为辅因子，而不是主因子。
5. 保留 `event-driven` 与 `high-volatility`，但要求其与机制判断并存，不得完全覆盖机制解释。
6. 为状态层输出增加足够的 `reasons` 与 `reasonCodes`，确保下游能解释 regime 为什么成立。
7. 更新 orchestrator 调用顺序，使状态层使用与参与者层一致的关键输入快照。

## 6. 禁止事项

- 不得把更多技术指标堆进状态层替代机制解释
- 不得让 `trend/range` 重新成为唯一解释框架
- 不得移除现有的低置信度与歧义保护
- 不得在本阶段修改数据库结构

## 7. 验收标准

- `价格上涨 + OI下降` 不应被简单解释为更强趋势延续。
- `价格下跌 + OI上升 + 负 funding` 能输出明确的空头主导或 squeeze 风险解释。
- `OI 急跌 + 价格同步下跌` 能输出 `deleveraging-vacuum`。
- 两组价格形态相似但 OI/funding/basis 不同的样本，状态层输出必须出现可解释差异。
- 状态层测试需覆盖：
  - 新多头推动
  - 新空头推动
  - 空头回补
  - 多头平仓
  - 去杠杆真空
  - 高波动但机制不清晰

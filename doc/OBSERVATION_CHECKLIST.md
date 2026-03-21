# Stratum 观察期简版清单

## Day 0

目标：

- 验证链路是否完整跑通
- 验证新样本是否按新口径入库

操作：

```bash
pnpm dev
pnpm report --risk
pnpm report --funnel
pnpm positions
```

必须确认：

- 已产生 `scan_logs`
- 已产生 `candidate_snapshots`
- `report --risk` 不再显示“暂无风险快照”
- `report --funnel` 开始出现 `blocked / skipped / sent / opened`
- 新 `positions` 带有 `risk_amount` 和 `account_risk_percent`
- Telegram 告警正常送达

禁止：

- 不允许调参数
- 不允许根据 Day 0 样本做策略判断

## Day 1

目标：

- 看链路是否稳定重复运行

重点看：

- `failed`
- `skipped_duplicate`
- `skipped_execution_gate`

判断：

- 如果异常主要来自告警失败或重复跳过，先修工程问题

## Day 2

目标：

- 看风险预算是否开始符合预期

重点看：

- 平均单笔风险
- 平均组合风险
- 峰值组合风险

判断：

- 如果组合风险经常顶到上限，先确认风控配置是否过紧

## Day 3

目标：

- 看样本是否开始进入可观察状态

重点看：

- `Sample` 列
- `Low sample`
- `No decisive closed trades`

判断：

- 如果几乎所有 bucket 都还是低样本，继续观察，不调策略

## Day 4

目标：

- 看 macro / execution funnel 是否有异常倾斜

重点看：

- `blocked_by_macro`
- `sent`
- `opened`

判断：

- 如果 macro block 异常高，先结合事件环境判断是否属于正常防守

## Day 5

目标：

- 看时段与 bias 是否开始有可比较样本

重点看：

- `Session`
- `DailyBias`
- `OrderFlowBias`

判断：

- 如果仍无决定性样本，不允许提“哪个 bucket 更好”

## Day 6

目标：

- 看是否仍存在工程问题遮蔽策略判断

重点看：

- 是否还有持续性 `failed`
- 是否还有异常 `skipped_duplicate`
- 是否还有 risk 字段缺失

判断：

- 只要工程问题还在持续，就不进入调参

## Day 7

目标：

- 做第一轮“是否允许调参”的结论

必须同时满足：

- 连续运行 7 天
- 主漏斗稳定
- 无持续性工程异常
- 至少一个主要 bucket 达到可解释样本
- 风险报表稳定

结论只允许是二选一：

1. 继续观察
2. 进入下一轮策略优化

## 每天固定命令

```bash
pnpm report --risk
pnpm report --funnel
```

## 配套文档

- [OBSERVATION_RUNBOOK.md](/Users/aries/Dve/crypto/Stratum/doc/OBSERVATION_RUNBOOK.md)
- [DAILY_OBSERVATION_TEMPLATE.md](/Users/aries/Dve/crypto/Stratum/doc/DAILY_OBSERVATION_TEMPLATE.md)

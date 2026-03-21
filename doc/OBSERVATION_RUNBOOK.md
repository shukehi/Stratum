# Stratum 观察期运营清单

## 1. 目标

本文档用于把 `PHASE_30` 到 `PHASE_33` 落地后的系统，推进到可持续观察和复盘的运营状态。

观察期的核心目标不是立刻调参数，而是回答四个问题：

1. 当前信号链路是否稳定运行
2. 当前风险预算是否符合真实执行习惯
3. 当前报表结论是否建立在足够样本之上
4. 哪些问题属于策略问题，哪些问题属于样本不足

## 2. 进入观察期前的前置条件

进入观察期前必须满足以下条件：

- `pnpm typecheck` 通过
- `pnpm test -- --pool forks` 通过
- `accountSizeUsd` 已配置为真实账户规模
- `maxSameDirectionOpenRiskPercent` 已配置
- `maxPortfolioOpenRiskPercent` 已配置
- Telegram 告警链路已验证可用

若以上任一条件不满足，当前系统仍属于研究态，不应开始正式观察。

## 3. 每日操作

每天至少执行两次：

1. 开盘前或主要交易时段前
2. 收盘后或主要交易时段结束后

固定命令：

```bash
pnpm report --risk
pnpm report --funnel
```

## 4. 每日必看指标

### 4.1 风险报表

必须检查：

- `仓位建议覆盖率`
- `平均单笔风险`
- `平均组合风险`
- `峰值组合风险`
- `skipped_execution_gate` 的数量是否异常上升

关注点：

- 若 `仓位建议覆盖率` 过低，说明账户参数或价格/止损数据仍不完整
- 若 `峰值组合风险` 经常逼近上限，说明组合预算过紧或信号密度过高
- 若执行门控跳过突然增多，应先确认是不是风险上限配置问题，而不是策略失效

### 4.2 漏斗报表

必须检查：

- `blocked_by_macro`
- `skipped_execution_gate`
- `skipped_duplicate`
- `failed`
- `sent`
- `opened`

关注点：

- `failed` 上升优先排查告警/网络问题
- `skipped_duplicate` 上升优先排查去重窗口是否过宽
- `blocked_by_macro` 上升优先结合新闻环境判断是否属于预期
- `sent -> opened` 若显著偏低，需要排查持仓记录链路

### 4.3 样本质量提示

必须关注 CLI 中的 `Sample` 列：

- `No decisive closed trades`
- `Low sample`

解释：

- `No decisive closed trades`：当前 bucket 还没有足够的 TP/SL 决策样本
- `Low sample`：已有样本，但不足以支持稳定结论

规则：

- 不允许根据 `Low sample` bucket 调参数
- 不允许根据单个 `100% winRate` 小样本 bucket 扩大风险

## 5. 每周复盘

每周固定做一次汇总复盘，建议以 7 天窗口为主。

固定命令：

```bash
pnpm report --all
```

复盘重点：

1. 哪些 `regime` 的 `sent -> closed` 样本开始变多
2. 哪些 `participantPressureType` 仍长期停留在低样本
3. 哪些 `macroAction=pass` 的后验结果持续变差
4. 哪些 `liquiditySession` 的表现稳定优于其他时段
5. 哪些 `dailyBias` / `orderFlowBias` bucket 仍没有决定性样本

## 6. 允许动作与禁止动作

### 6.1 允许动作

- 调整告警或报表展示
- 修复持久化、归因、回测与报表口径不一致问题
- 修复明显的执行链路 bug
- 补测试和补观察字段

### 6.2 禁止动作

在满足以下任一条件前，禁止调策略参数：

- 观察期不足 7 天
- 关键 bucket 仍大量显示 `Low sample`
- `blocked / skipped / sent / opened` 漏斗还在明显漂移
- 风险参数尚未稳定

禁止直接调整：

- `minStructureScore`
- `minimumRiskReward`
- `maxStopDistanceAtr`
- `minParticipantConfidence`
- `confluenceBonus`

除非：

- 有连续观察样本支持
- 有明确归因说明为什么该参数是问题源头

## 7. 升级到“可调参状态”的门槛

只有当以下条件同时成立，才允许进入下一轮策略优化：

- 连续运行至少 7 天
- `pnpm report --funnel` 的主要 bucket 不再以 `Low sample` 为主
- 至少一个主要 `regime` bucket 具备 `>= 5` 笔 decisive closed trades
- `report --risk` 中组合风险表现稳定，没有频繁触顶
- 没有持续性的 `failed` 或异常 `skipped_duplicate`

## 8. 推荐观察记录模板

建议每天记录以下 6 项：

1. 日期
2. `blocked_by_macro / skipped_execution_gate / skipped_duplicate / failed / sent / opened`
3. 当天最高组合风险
4. 主要 `Low sample` bucket
5. 是否有异常新闻/事件驱动日
6. 是否需要修工程问题，而不是调策略

可直接使用：

- [DAILY_OBSERVATION_TEMPLATE.md](/Users/aries/Dve/crypto/Stratum/doc/DAILY_OBSERVATION_TEMPLATE.md)
- [OBSERVATION_CHECKLIST.md](/Users/aries/Dve/crypto/Stratum/doc/OBSERVATION_CHECKLIST.md)

## 9. 退出观察期的条件

满足以下条件后，可以结束观察期，进入下一轮优化：

- 执行链路稳定
- 报表口径稳定
- 样本质量足以支持判断
- 有至少一个明确的“下一轮该优化什么”的结论

如果观察期结束后仍无法回答“该优化什么”，说明问题通常不是参数，而是样本量仍然不够。

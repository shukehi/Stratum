# Stratum 指标与验收标准

## 1. 文档目标

本文档定义优化阶段完成后的核心衡量方式。

原则：

- 先衡量因果链是否完整
- 再衡量行为是否真实
- 最后衡量统计表现是否稳定

## 2. 一级指标：因果链完整性

### 2.1 结构前置过滤率

定义：

- 在进入结构检测前即被状态/参与者门控拦截的扫描周期占比

目标：

- 必须大于 0
- 且在真实运行中应明显高于“仅因结构分不够而跳过”的比例

含义：

- 若该值接近 0，说明系统仍然主要依赖结构层找机会

### 2.2 Skip Reason 覆盖率

定义：

- `无候选扫描周期中，具备 skipStage + skipReasonCode 的周期 / 全部无候选周期`

目标：

- `100%`

### 2.3 Candidate 归因完整率

定义：

- 每个 candidate 是否同时保留以下信息：
  - regime snapshot
  - participant snapshot
  - confirmation status
  - daily bias
  - order flow bias
  - macro action

目标：

- `100%`

## 3. 二级指标：行为真实性

### 3.1 信号产生比例

定义：

- `产生至少一个 candidate 的扫描周期 / 全部扫描周期`

目标区间：

- `5% ~ 30%`

解释：

- 高于 30%：过滤过松
- 低于 5%：可能过严或状态层过度悲观

### 3.2 Pending 与 Confirmed 质量差

定义：

- 比较 `pending/watch` 与 `confirmed` 样本的胜率和平均 `pnlR`

目标：

- `confirmed` 的胜率和平均 `pnlR` 必须高于 `pending`

### 3.3 Confluence 增益

定义：

- 比较单结构 vs 双结构 vs 三结构以上汇聚样本

目标：

- 结构汇聚度越高，整体表现越好

如果不成立：

- 说明 `confluenceBonus` 只是叙事，没有统计支持

### 3.4 Session 差异有效性

定义：

- 比较 `asian_low / london_ramp / london_ny_overlap / ny_close` 的信号质量

目标：

- `london_ramp` 和 `london_ny_overlap` 应整体优于 `asian_low`

如果不成立：

- 需复审时段修正逻辑

### 3.5 Basis Divergence 增益

定义：

- 比较存在 `basisDivergence` 与不存在该特征的样本表现

目标：

- 在对应方向上，有背离的样本表现应更优

## 4. 三级指标：认知诚实性

### 4.1 Block 样本后验表现

定义：

- 统计 `blocked_by_macro` 的样本后续表现

目标：

- 被 block 样本的胜率应低于正常放行样本

解释：

- 若更高，说明宏观层在误杀

### 4.2 无法归因亏损比例

定义：

- 亏损样本中，无法明确归因到 regime / participant / structure / confirmation / macro 任一层的问题占比

目标：

- 低于 `10%`

### 4.3 自动改参次数

定义：

- 未经人工审核而自动修改 `strategyConfig` 的次数

目标：

- `0`

## 5. 推荐数据字段

建议候选与扫描记录至少保留下列字段：

- `skip_stage`
- `skip_reason_code`
- `regime`
- `regime_confidence`
- `driver_type`
- `participant_bias`
- `participant_pressure_type`
- `participant_confidence`
- `basis_divergence`
- `liquidity_session`
- `structure_score`
- `confluence_count`
- `confirmation_status`
- `daily_bias`
- `order_flow_bias`
- `macro_action`
- `alert_status`

## 6. 推荐报表

至少提供以下六类报表：

1. 总体扫描漏斗
   - scanned
   - skipped before structure
   - setups found
   - candidates after risk
   - candidates after macro
   - alerts sent

2. 按 regime 分组表现

3. 按 participant pressure 分组表现

4. 按 confirmation status 分组表现

5. 按 macro action 分组表现

6. 按 confluence/session/basisDivergence 分组表现

## 7. Phase 验收门槛

### PHASE_30

- 状态层输出能够区分“新开仓推动”与“平仓驱动”
- regime 决策不再只依赖价格行为

### PHASE_31

- 结构层前存在硬门控
- 宏观评估按 candidate 粒度执行

### PHASE_32

- 无信号周期具备结构化 skip reason
- block 样本可以回看和统计
- 回测重放真实决策顺序

### PHASE_33

- 告警输出建议仓位
- 风险预算与同向暴露限制进入实际链路

## 8. 观察期运营

完成 `PHASE_33` 后，不应直接进入调参。

下一步应进入观察期，并遵循：

- [OBSERVATION_RUNBOOK.md](/Users/aries/Dve/crypto/Stratum/doc/OBSERVATION_RUNBOOK.md)

观察期的目标是验证：

- 风险参数是否符合真实执行习惯
- 漏斗与结果报表是否已具备足够样本
- 当前优化结论是否具有统计稳定性

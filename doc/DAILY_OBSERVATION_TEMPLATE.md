# Stratum 每日观察记录模板

## 使用方式

每天固定填一次，建议在主要交易时段结束后填写。

配套命令：

```bash
pnpm report --risk
pnpm report --funnel
```

---

## 记录模板

### 1. 基本信息

- 日期：
- 观察窗口：
- 是否事件日：
- 事件说明：

### 2. 漏斗摘要

- blocked_by_macro：
- skipped_execution_gate：
- skipped_duplicate：
- failed：
- sent：
- opened：

### 3. 风险摘要

- 仓位建议覆盖率：
- 平均单笔风险：
- 平均组合风险：
- 峰值组合风险：

### 4. 样本质量

- 主要 `Low sample` buckets：
- 主要 `No decisive closed trades` buckets：
- 今天是否已有可形成判断的 bucket：

### 5. 运行异常

- 是否出现告警失败异常：
- 是否出现异常重复跳过：
- 是否出现风险门控异常升高：
- 其他工程异常：

### 6. 当日判断

- 今天更像是工程问题还是策略问题：
- 原因：
- 是否允许调参：
- 若不允许，当前阻塞是什么：

### 7. 次日动作

- 明天继续观察的重点：
- 需要修复的工程问题：
- 暂不处理但需跟踪的问题：

---

## 简版示例

- 日期：2026-03-21
- 观察窗口：纽约时段后
- 是否事件日：是
- 事件说明：FOMC

- blocked_by_macro：6
- skipped_execution_gate：2
- skipped_duplicate：1
- failed：0
- sent：3
- opened：3

- 仓位建议覆盖率：100%
- 平均单笔风险：$950
- 平均组合风险：2.1%
- 峰值组合风险：2.9%

- 主要 `Low sample` buckets：`range / asian_low / bearish`
- 主要 `No decisive closed trades` buckets：`downgrade / london_ramp`
- 今天是否已有可形成判断的 bucket：否

- 今天更像是工程问题还是策略问题：工程问题
- 原因：`skipped_execution_gate` 较昨天明显升高，需要先确认组合风险配置是否过紧
- 是否允许调参：否
- 若不允许，当前阻塞是什么：样本不足 + 风险上限原因未确认

- 明天继续观察的重点：`pass / london_ny_overlap` 的 sent 后结果
- 需要修复的工程问题：无
- 暂不处理但需跟踪的问题：`downgrade` bucket 长期低样本

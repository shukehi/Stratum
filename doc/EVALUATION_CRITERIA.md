# Stratum 2.0 物理评价准则

> "物理一致性是评价系统的唯一标准。如果数据说发生了坍缩，但信号未捕捉，就是系统的失效。"

## 1. 动能感应的一致性 (Sensing Consistency)

### 3-Sigma 异常有效性
- **评估方法**：回顾所有历史清算行情。
- **预期结果**：100% 的极速穿刺行情必须对应 `OI Crash Index < -3.0`。
- **失效判定**：如果 Index 在清算行情中未达标，说明 lookback 窗口或采样频率存在熵增，必须重构。

## 2. 资本调度的合理性 (Dispatching Consistency)

### CVS 期望闭环
- **评估方法**：对比不同 CVS 分桶的后验 PnL。
- **预期结果**：高 CVS 信号（CVS > 85）的累计 R 乘数必须显著高于低 CVS 信号。
- **失效判定**：如果低 CVS 信号表现更好，说明 `computeCVS` 算法中的物理权重因子（如 RR 加成）与市场动能脱节。

## 3. 执行闭环的零延迟 (Execution Consistency)

### FSD 自动驾驶完整性
- **评估方法**：核对 `candidate_snapshots` 与 `positions` 的时间戳对齐。
- **预期结果**：执行延迟（Execution Lag）应控制在交易所 API 响应的物理极限内（< 200ms）。
- **失效判定**：任何需要碳基生物介入的中间态（如不必要的 pending）均被视为系统设计的严重摩擦。

## 4. 故障报警的信噪比 (Alert SNR)

### 静默准则验证
- **预期结果**：在正常盈利/止损循环中，Telegram 保持完全静默。
- **失效判定**：如果系统发送了关于常规交易成功的通知，说明“静默法则”未被物理贯彻，制造了不必要的认知熵。

**"Believe the math. Trust the data. Delete the narrative."**

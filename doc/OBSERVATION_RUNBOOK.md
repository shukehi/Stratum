# Stratum 2.0 运行观察手册 (Physics First)

> "不需要观察信号好不好看，只需要观察物理引擎是否在按照定律点火。"

## 1. 核心监视路径 (The Vigil)

### A. 动能感应审计
- **操作**：定期查看 `pnpm report --logs`。
- **物理重点**：核对 `OI Crash Index`。
- **预期**：如果价格剧烈运动但 Index > -3.0，说明系统正确识别了噪音。如果发生 3-Sigma 坍缩，系统必须在 structureReason 中有物理标记。

### B. 资本真空检测
- **操作**：观察 `pnpm report --funnel`。
- **物理重点**：关注 `Swap Count`。
- **预期**：系统应冷酷地平掉低 CVS 持仓，为高期望信号让路。如果出现高 CVS 信号但未执行置换，检查 `ExposureGate` 逻辑是否出现熵增。

---

## 2. FSD 故障排查 (FSD Anomaly)

### 故障 A：系统尖叫（Telegram 警报）
- **原因**：通常是物理摩擦力超限。
- **排查**：
    1. 检查 API 响应时间。
    2. 核对实盘成交价与 CVS 预期价的滑点（Slippage）。
    3. 若滑点持续 > 0.5%，需调整 CVS 算法中的物理惩罚因子。

### 故障 B：静默失败（无信号产出）
- **排查**：
    1. 检查物理感应器数据流是否中断。
    2. 确认 3-Sigma 的 lookback 窗口是否包含足够的样本（需 50 根 K 线以上）。

---

## 3. 性能修正协议 (Recalibration)

- **CVS 修正**：如果高 CVS 信号频繁止损，说明权重因子过高，需降低 `Multiplier_Alignment`。
- **Sigma 修正**：如果错过明显清算行情，可考虑将阈值从 3.0 降至 2.5；如果系统频繁捕捉震荡，将阈值升至 3.5。

**"The machine is an autonomous predator. Humans only adjust its senses."**

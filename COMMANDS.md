# Stratum 指令与操作手册 (V2.0 Physics)

## 启动系统 (FSD Mode)

```bash
pnpm dev
```
启动核心物理管道：3-Sigma 动能感应器 + CVS 调度引擎 + FSD 全静默执行器。

---

## VPS 生产级部署

> 系统已针对"真空环境"优化，支持 Node.js 原生直跑。

### 1. 自动部署与预检
```bash
bash ./scripts/deploy-vps.sh
```
该脚本将执行物理一致性检查：`typecheck` -> `test` -> `build (dist)`。

### 2. 最小 .env 配置
```env
EXCHANGE_NAME=binanceusdm
SYMBOL=BTC/USDT:USDT
SPOT_SYMBOL=BTC/USDT
DATABASE_URL=./stratum.db
LOG_LEVEL=info
```
*注：不再需要任何 LLM 或 News API 密钥。系统已零熵化。*

### 3. FSD 守护进程启动
```bash
sudo ./scripts/boot.sh --logs
```
安装并启动 systemd 守护进程，进入静默监控状态。

---

## 报告分析 (Physics Reporting)

```bash
# 整体统计 (扫描次数 / 胜率 / 总R / CVS分布)
pnpm report

# 按 CVS 动能分布分析
pnpm report --grade

# 执行漏斗与置换效率 (Swap counts / Success rate)
pnpm report --funnel

# 最近扫描日志 (物理参数验证)
pnpm report --logs
```

---

## 物理回测 (Verification)

```bash
# 运行 3-Sigma 物理验证回测
pnpm backtest --symbol BTCUSDT --limit 500
```
**数据驱动准则**：系统优先使用本地缓存 K 线，自动执行全链路物理重放。

---

## FSD 遥测规则 (Telemetry)

| 事件 | 触发时机 | 动作 |
|------|---------|------|
| ⚡ 物理信号 | CVS 评分达标且 3-Sigma OI 验证通过 | **自动模拟执行 (Silent)** |
| 🔄 资本置换 | 新信号 CVS > 旧头寸 CVS * 1.2 | **自动平旧开新** |
| ⚠️ 物理异常 | API 崩溃 / 滑点超限 / 网络致命错误 | **紧急推送 (Telegram/Discord)** |
| ✅ 目标触达 | 价格命中 TP/SL | 静默记录，不占带宽 |

---

## 信号扫描时间 (UTC)

收盘后 30 秒触发，毫秒级完成物理感应：
`00:00:30` · `04:00:30` · `08:00:30` · `12:00:30` · `16:00:30` · `20:00:30`

---
**"No human interaction required. The machine obeys only physical data."**

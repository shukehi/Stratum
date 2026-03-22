# Stratum 命令手册

## 启动系统

```bash
pnpm dev
```

启动四个调度器（信号扫描 / 仓位监控 / 时段监控 / 心跳通知），持续运行直到 `Ctrl+C`。

---

## VPS 部署与测试

> 仓库内已提供最小可用部署资产：`.env.example`、`scripts/deploy-vps.sh`、`scripts/update-vps.sh`、`scripts/run-service.sh`、`scripts/boot.sh`、`scripts/install-systemd-service.sh`、`scripts/install-systemd-update-timer.sh`、`deploy/stratum.service`。

### 1. VPS 基础环境

推荐 Ubuntu 22.04+，先安装 Node.js 20+ 与 pnpm：

```bash
sudo apt update
sudo apt install -y git curl build-essential python3
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo corepack enable
sudo corepack prepare pnpm@latest --activate
```

### 2. 拉代码并执行预检查

```bash
git clone <repo-url> /opt/stratum
cd /opt/stratum
bash ./scripts/deploy-vps.sh
```

该脚本会自动完成：

1. `.env` 不存在时从 `.env.example` 生成
2. 创建 `DATABASE_URL` 对应目录
3. 安装依赖
4. 重建 `better-sqlite3` 原生绑定
5. 运行 `pnpm typecheck`
6. 运行 `pnpm test`
7. 运行 `pnpm build`

### 3. 最小 `.env` 配置

```env
EXCHANGE_NAME=binance
SYMBOL=BTC/USDT:USDT
SPOT_SYMBOL=BTC/USDT
DATABASE_URL=./data/stratum.db
LOG_LEVEL=info
```

以下变量可先留空，仅在需要相关能力时再填写：

- `NEWS_API_KEY`
- `LLM_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

### 4. 手动测试

```bash
pnpm backtest --symbol BTCUSDT --limit 300
pnpm report --all
pnpm dev
```

### 5. 挂成 systemd 服务

```bash
sudo ./scripts/install-systemd-service.sh
journalctl -u stratum.service -f
```

如果你只想“一键运行”，直接用：

```bash
cd /opt/stratum
sudo ./scripts/boot.sh
```

如果你想启动后立刻跟日志：

```bash
cd /opt/stratum
sudo ./scripts/boot.sh --logs
```

服务会通过 `scripts/run-service.sh` 启动，它会：

1. 检查 `.env` 是否存在
2. 预热固定版本的 `pnpm`
3. 再执行 `pnpm dev`

如果启动失败，优先查看：

```bash
systemctl status stratum.service
journalctl -u stratum.service -n 100 --no-pager
```

如需手动调整模板，可编辑 `deploy/stratum.service`。

### 6. 后续更新 VPS

```bash
cd /opt/stratum
bash ./scripts/update-vps.sh
```

该脚本会自动完成：

1. `git pull --ff-only`
2. 安装依赖
3. 重建 `better-sqlite3` 原生绑定
4. 运行 `pnpm typecheck`
5. 运行 `pnpm test`
6. 运行 `pnpm build`
7. 检测到 `stratum.service` 时自动重启

每次执行都会把完整输出写入 `logs/update-*.log`。如果中途失败，脚本会自动打印：

1. 当前更新日志最后 40 行
2. `stratum.service` 最近 40 行 journal 日志（如果服务存在）

如果你的 systemd 单元名不是 `stratum.service`，可这样运行：

```bash
SERVICE_NAME=my-stratum.service bash ./scripts/update-vps.sh
```

### 7. 安装自动更新定时器

```bash
cd /opt/stratum
sudo ./scripts/install-systemd-update-timer.sh
systemctl list-timers --all | grep stratum-update
```

默认计划：

1. 每天本地时间 `05:15`
2. 最多随机延迟 `10` 分钟，避免固定时刻冲击
3. 机器离线错过后，下次开机自动补跑

定时器模板位于 `deploy/stratum-update.timer`，服务模板位于 `deploy/stratum-update.service`。

---

## 报告分析

> 读取本地 SQLite 数据库，无需网络。需先运行 `pnpm dev` 积累数据。

```bash
# 整体统计摘要（扫描次数 / 信号数 / 胜率 / 总R / 宏观过滤）
pnpm report

# 按信号等级分析（watch / standard / high-conviction）
pnpm report --grade

# 按方向分析（多头 vs 空头）
pnpm report --direction

# 按结构类型分析（FVG / 流动性扫描）
pnpm report --structure

# 宏观过滤效果（block / downgrade / pass 各占比）
pnpm report --macro

# 最近 20 次扫描日志
pnpm report --logs

# 最近 N 次扫描日志（自定义数量）
pnpm report --logs 50

# 显示全部分析维度
pnpm report --all
```

---

## 持仓查询

> 显示当前所有 open 模拟仓位。

```bash
pnpm positions
```

输出内容：方向 / 品种 / 入场价 / 止损 / 止盈 / 风险收益比(R:R) / 开仓时间(UTC)

---

## 回测

> 优先使用本地缓存 K 线数据（PHASE_15），本地数据不足或过期时才联网拉取。

```bash
# BTC 回测（默认 500 根 4h K线）
pnpm backtest

# 指定品种
pnpm backtest --symbol ETHUSDT

# 指定 K 线数量
pnpm backtest --limit 300

# 指定品种 + 数量
pnpm backtest --symbol ETHUSDT --limit 300

# 强制从交易所重新拉取（忽略本地缓存）
pnpm backtest --fresh
pnpm backtest --symbol ETHUSDT --fresh
```

**数据来源策略：**
1. 本地 SQLite 有足够数据且最新一根在一个周期内 → 直接使用，无需网络
2. 数据不足或过期 → 从交易所拉取并保存到本地，供下次复用

输出内容：信号数 / 止盈止损过期数量 / 胜率 / 平均R / 累计R / 最大回撤 / Sharpe 比 / 前10笔明细

---

## 帮助

```bash
pnpm cli help
```

---

## 环境变量配置（.env）

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `EXCHANGE_NAME` | 交易所（期货用 binanceusdm） | `binance` |
| `SYMBOL` | 合约品种 | `BTC/USDT:USDT` |
| `SPOT_SYMBOL` | 现货品种 | `BTC/USDT` |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token | — |
| `TELEGRAM_CHAT_ID` | Telegram Chat ID | — |
| `LLM_API_KEY` | LLM API Key | — |
| `LLM_PROVIDER` | `anthropic` 或 `openrouter` | `anthropic` |
| `LLM_MODEL` | 模型名称（如 `google/gemini-flash-1.5`） | provider 默认值 |
| `NEWS_API_KEY` | NewsAPI Key | — |
| `DATABASE_URL` | SQLite 文件路径 | `./stratum.db` |
| `ACCOUNT_SIZE` | 账户规模（USD） | `10000` |
| `RISK_PER_TRADE` | 单笔风险比例（最大 0.05） | `0.01` |
| `HEARTBEAT_INTERVAL_H` | 心跳通知间隔（小时） | `6` |
| `LOG_LEVEL` | 日志级别（trace/debug/info/warn/error） | `info` |

---

## Telegram 通知触发条件

| 事件 | 触发时机 |
|------|---------|
| 📊 交易信号 | 每 4h 扫描发现结构信号且通过宏观过滤 |
| ✅ 止盈平仓 | 模拟仓位价格触及止盈价（每 30s 检查） |
| 🛑 止损平仓 | 模拟仓位价格触及止损价（每 30s 检查） |
| 🌏 时段切换 | 亚洲盘/欧洲盘/伦纽重叠/美盘 开启时（北京 06/14/16/00 点） |
| 💓 心跳通知 | 每 N 小时推送系统状态摘要（默认 6h） |

---

## 交易时段（北京时间）

| 时段 | 北京时间 | 特征 |
|------|---------|------|
| 🌏 亚洲盘 | 06:00 – 14:00 | 流动性低，信号折扣 20% |
| 🇬🇧 欧洲盘启动 | 14:00 – 16:00 | 流动性上升，信号溢价 10% |
| 🌐 伦敦/纽约重叠 | 16:00 – 00:00 | 主力时段，流动性最强 |
| 🇺🇸 美盘收盘区间 | 00:00 – 06:00 | 收盘前关注方向性突破 |

---

## 日线结构过滤（PHASE_16）

每次 4h 信号扫描时同步拉取最近 100 根日线 K 线，检测日线市场结构：

| 结构 | 说明 | 对信号的影响 |
|------|------|-------------|
| `HH_HL`（更高摆高 + 更高摆低） | 多头结构 | 多头信号 + `DAILY_TREND_ALIGNED`，空头信号降级 + `DAILY_TREND_COUNTER` |
| `LH_LL`（更低摆高 + 更低摆低） | 空头结构 | 空头信号 + `DAILY_TREND_ALIGNED`，多头信号降级 + `DAILY_TREND_COUNTER` |
| `HH_LL` / `LH_HL` / `insufficient` | 中性 | 不干扰信号等级 |

枢纽检测：摆高/摆低需严格大于/小于左右各 3 根 K 线（7 根窗口）。

---

## 信号扫描时间（北京时间）

每天固定 6 次，收盘后 30 秒触发：

`08:00:30` · `12:00:30` · `16:00:30` · `20:00:30` · `00:00:30` · `04:00:30`

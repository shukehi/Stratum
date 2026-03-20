# Stratum 命令手册

## 启动系统

```bash
pnpm dev
```

启动四个调度器（信号扫描 / 仓位监控 / 时段监控 / 心跳通知），持续运行直到 `Ctrl+C`。

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

> 从交易所实时拉取 K 线数据，运行 walk-forward 回测，输出统计报告。需要网络连接。

```bash
# BTC 回测（默认 500 根 4h K线）
pnpm backtest

# 指定品种
pnpm backtest --symbol ETHUSDT

# 指定 K 线数量
pnpm backtest --limit 300

# 指定品种 + 数量
pnpm backtest --symbol ETHUSDT --limit 300
```

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

## 信号扫描时间（北京时间）

每天固定 6 次，收盘后 30 秒触发：

`08:00:30` · `12:00:30` · `16:00:30` · `20:00:30` · `00:00:30` · `04:00:30`

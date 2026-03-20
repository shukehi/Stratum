import { CcxtClient } from "../clients/exchange/ccxt-client.js";
import { strategyConfig } from "../app/config.js";
import { generateBacktestSignals, runBacktest } from "../services/backtest/run-backtest.js";
import { computeStats } from "../services/backtest/compute-stats.js";
import { header, section, kv, fmtR, fmtPct, dim, green, red, yellow, gray, bold, HR } from "./fmt.js";

/**
 * backtest 子命令
 *
 * 用法：
 *   pnpm backtest                      → BTC/USDT:USDT，500 根 4h K线
 *   pnpm backtest --symbol ETHUSDT     → 指定品种
 *   pnpm backtest --limit 200          → 指定 K线数量
 */
export async function cmdBacktest(args: string[], exchangeName: string, spotSymbol: string): Promise<void> {
  // ── 解析参数 ──────────────────────────────────────────────────────────────
  const symbol = parseArg(args, "--symbol") ?? "BTCUSDT";
  const limit  = parseInt(parseArg(args, "--limit") ?? "500", 10);

  header(`🔄  回测引擎  —  ${symbol}`);
  console.log(dim(`  K线数量: ${limit} 根 4h  |  交易所: ${exchangeName}`));
  console.log();

  // ── 拉取市场数据 ──────────────────────────────────────────────────────────
  process.stdout.write("  📡 正在拉取数据...");
  const client = new CcxtClient(exchangeName, spotSymbol);

  let candles4h, candles1h;
  try {
    [candles4h, candles1h] = await Promise.all([
      client.fetchOHLCV(symbol, "4h", limit),
      client.fetchOHLCV(symbol, "1h", limit * 4),
    ]);
    process.stdout.write(` 完成 (${candles4h.length} 根 4h / ${candles1h.length} 根 1h)\n`);
  } catch (err: any) {
    process.stdout.write(" 失败\n");
    console.error(red(`  ✗ 数据拉取错误：${err.message}`));
    return;
  }

  if (candles4h.length < 60) {
    console.log(red(`  ✗ 数据不足（只有 ${candles4h.length} 根），至少需要 60 根 4h K线`));
    return;
  }

  // ── 生成信号 ──────────────────────────────────────────────────────────────
  process.stdout.write("  🔍 正在生成回测信号...");
  const config  = strategyConfig;
  const signals = generateBacktestSignals(candles4h, candles1h, config);
  process.stdout.write(` 发现 ${signals.length} 个信号\n`);

  if (signals.length === 0) {
    console.log(dim("  在此区间未发现符合条件的结构信号。"));
    return;
  }

  // ── 模拟交易 ──────────────────────────────────────────────────────────────
  process.stdout.write("  ⚙️  正在模拟交易...");
  const trades = runBacktest(signals, candles4h);
  const stats  = computeStats(trades);
  process.stdout.write(" 完成\n");

  // ── 统计结果 ──────────────────────────────────────────────────────────────
  section("📊  回测统计");

  kv("信号总数",  String(stats.totalTrades));
  kv("已结束",   String(stats.closedTrades));

  const tpCount  = trades.filter(t => t.status === "closed_tp").length;
  const slCount  = trades.filter(t => t.status === "closed_sl").length;
  const expCount = trades.filter(t => t.status === "expired").length;
  kv("  ├── 止盈", green(`${tpCount} 笔  (${pct(tpCount, stats.totalTrades)})`));
  kv("  ├── 止损", red(`${slCount} 笔  (${pct(slCount, stats.totalTrades)})`));
  kv("  └── 过期", dim(`${expCount} 笔  (${pct(expCount, stats.totalTrades)})`));

  console.log();

  if (stats.closedTrades > 0) {
    kv("胜率",     fmtPct(stats.winRate));
    kv("平均盈亏",  fmtR(stats.avgPnlR));
    kv("累计总R",  fmtR(stats.totalR));
    kv("最大回撤",  red(`-${stats.maxDrawdownR.toFixed(2)}R`));
    kv("Sharpe 比", fmtSharpe(stats.sharpeRatio));
  } else {
    console.log(dim("  所有信号均已过期（未触及 TP/SL）"));
  }

  // ── 信号明细（前 10 个）────────────────────────────────────────────────────
  section("📋  信号明细（前 10 个）");

  const preview = trades.slice(0, 10);
  const rows = preview.map((t, i) => {
    const statusLabel =
      t.status === "closed_tp" ? green("止盈 ✓") :
      t.status === "closed_sl" ? red("止损 ✗") :
      dim("过期");

    return {
      "#":   String(i + 1),
      方向:  t.signal.direction === "long" ? green("多") : red("空"),
      入场:  `$${Math.round(t.entryPrice).toLocaleString()}`,
      出场:  `$${Math.round(t.exitPrice).toLocaleString()}`,
      结果:  statusLabel,
      盈亏:  fmtR(t.pnlR),
    };
  });

  const { printTable } = await import("./fmt.js");
  printTable(["#", "方向", "入场", "出场", "结果", "盈亏"], rows);

  if (trades.length > 10) {
    console.log(dim(`  ... 共 ${trades.length} 笔，仅显示前 10 笔`));
  }

  console.log();
}

// ── 内部辅助 ──────────────────────────────────────────────────────────────────

function parseArg(args: string[], flag: string): string | null {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

function pct(n: number, total: number): string {
  return total > 0 ? `${((n / total) * 100).toFixed(0)}%` : "0%";
}

function fmtSharpe(s: number): string {
  const str = s.toFixed(2);
  if (s >= 1.0) return green(str);
  if (s >= 0.5) return yellow(str);
  return red(str);
}

/**
 * Stratum CLI 入口
 *
 * 用法：
 *   pnpm report                        整体统计摘要
 *   pnpm report --grade                按信号等级分析
 *   pnpm report --direction            按多/空方向分析
 *   pnpm report --structure            按结构类型（FVG/流动性扫描）分析
 *   pnpm report --funnel               执行漏斗与交叉分桶
 *   pnpm report --risk                 仓位建议与组合风险
 *   pnpm report --logs [N]             最近 N 次扫描日志（默认 20）
 *   pnpm report --all                  显示全部分析
 *
 *   pnpm positions                     当前模拟持仓列表
 *
 *   pnpm backtest                      BTC 回测（默认 500 根 4h K线）
 *   pnpm backtest --symbol ETHUSDT     指定品种
 *   pnpm backtest --limit 200          指定 K线数量
 */

import BetterSqlite3 from "better-sqlite3";
import { env } from "../app/env.js";
import { cmdReport }    from "./cmd-report.js";
import { cmdPositions } from "./cmd-positions.js";
import { cmdBacktest }  from "./cmd-backtest.js";
import { bold, red, dim, cyan } from "./fmt.js";

// ── 解析子命令 ────────────────────────────────────────────────────────────────

const argv    = process.argv.slice(2);   // ["report", "--grade"] 等
const command = argv[0] ?? "help";
const args    = argv.slice(1);

// ── 执行 ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  switch (command) {
    case "report": {
      const db = new BetterSqlite3(env.DATABASE_URL, { readonly: true });
      await cmdReport(args, db);
      db.close();
      break;
    }

    case "positions": {
      const db = new BetterSqlite3(env.DATABASE_URL, { readonly: true });
      await cmdPositions(db);
      db.close();
      break;
    }

    case "backtest": {
      await cmdBacktest(args, env.EXCHANGE_NAME, env.SPOT_SYMBOL, env.DATABASE_URL);
      break;
    }

    case "help":
    default: {
      printHelp();
      break;
    }
  }
}

function printHelp(): void {
  console.log();
  console.log(bold(cyan("  Stratum CLI")));
  console.log();
  console.log(bold("  报告分析:"));
  console.log(`    ${cyan("pnpm report")}                  整体统计摘要`);
  console.log(`    ${cyan("pnpm report --grade")}          按信号等级（watch / standard / high-conviction）`);
  console.log(`    ${cyan("pnpm report --direction")}      按方向（多头 vs 空头）`);
  console.log(`    ${cyan("pnpm report --structure")}      按结构类型（FVG / 流动性扫描）`);
  console.log(`    ${cyan("pnpm report --funnel")}         执行漏斗（blocked / skipped / sent / opened）`);
  console.log(`    ${cyan("pnpm report --risk")}           仓位建议覆盖率与组合风险`);
  console.log(`    ${cyan("pnpm report --logs")}           最近 20 次扫描日志`);
  console.log(`    ${cyan("pnpm report --logs 50")}        最近 50 次扫描日志`);
  console.log(`    ${cyan("pnpm report --all")}            显示全部分析`);
  console.log();
  console.log(bold("  持仓查询:"));
  console.log(`    ${cyan("pnpm positions")}               当前所有模拟持仓`);
  console.log();
  console.log(bold("  回测:"));
  console.log(`    ${cyan("pnpm backtest")}                BTC 回测（500 根 4h K线）`);
  console.log(`    ${cyan("pnpm backtest --symbol ETHUSDT --limit 300")}  指定品种和数量`);
  console.log();
  console.log(dim("  注：report / positions 读取本地 SQLite，需先运行 pnpm dev 积累数据。"));
  console.log(dim("      backtest 从交易所实时拉取数据，需要网络连接。"));
  console.log();
}

main().catch((err) => {
  console.error(red(`  ✗ CLI 错误：${err.message}`));
  process.exit(1);
});

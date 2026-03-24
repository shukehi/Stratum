import BetterSqlite3 from "better-sqlite3";
import { runSignalScan } from "../services/orchestrator/run-signal-scan.js";
import { CcxtClient } from "../clients/exchange/ccxt-client.js";
import { env } from "../app/env.js";
import { bold, cyan, green, yellow, red, dim } from "./fmt.js";

/**
 * 单次扫描模拟 (TASK-P3-C Dry-run)
 */
export async function cmdScan(args: string[]): Promise<void> {
  const symbol = args.find(a => a.startsWith("--symbol="))?.split("=")[1] ?? env.SYMBOL;
  const perpSymbol = symbol.replace("/", "").replace(":USDT", "");
  
  console.log();
  console.log(bold(cyan(`  Stratum 单次全息扫描验证 (${symbol})`)));
  console.log(dim("  --------------------------------------------------"));

  const client = new CcxtClient(env.EXCHANGE_NAME, env.SPOT_SYMBOL);
  const db = new BetterSqlite3(env.DATABASE_URL);
  
  // 模拟 NotificationConfig (控制台输出)
  const notificationConfig = {};

  try {
    const result = await runSignalScan(perpSymbol, env.SPOT_SYMBOL, {
      client,
      db,
      notificationConfig
    });

    console.log();
    console.log(bold(green("  ✓ 扫描流水线执行完毕")));
    console.log(`  - 寻找候选: ${result.candidatesFound}`);
    console.log(`  - 警告发送: ${result.alertsSent}`);
    console.log(`  - 警告跳过: ${result.alertsSkipped}`);
    console.log(`  - 警告失败: ${result.alertsFailed}`);
    console.log(`  - 市场状态: ${result.regime}`);
    if (result.errors.length > 0) {
      console.log(red(`  - 捕获异常: ${result.errors.length} 个`));
      result.errors.forEach(e => console.log(dim(`    ! ${e}`)));
    }

    if (result.alertsSent > 0) {
      console.log();
      console.log(bold(yellow("  [提示] 扫描发现有效信号并已模拟执行。请执行 `pnpm positions` 查看数据库记录。")));
    } else {
      console.log();
      console.log(dim("  [提示] 未发现符合当前物理门槛的入场信号。"));
    }

  } catch (err: any) {
    console.log(red(`  ✗ 扫描中断: ${err.message}`));
  } finally {
    db.close();
  }
  console.log();
}

import Database from "better-sqlite3";
import { getOpenPositions } from "../services/positions/track-position.js";
import { header, kv, fmtPrice, fmtTime, printTable, dim, green, red, yellow, bold, gray, HR } from "./fmt.js";

/**
 * positions 子命令
 *
 * 用法：
 *   pnpm positions   → 显示当前所有 open 模拟仓位
 */
export async function cmdPositions(db: Database.Database): Promise<void> {
  header("📂  当前模拟持仓");

  const positions = getOpenPositions(db);

  if (positions.length === 0) {
    console.log(dim("  当前无持仓。"));
    console.log(dim("  等待信号扫描器发现入场机会后自动开仓。"));
    console.log();
    return;
  }

  console.log(dim(`  共 ${positions.length} 笔持仓`));
  console.log();

  printTable(
    ["#", "方向", "品种", "入场价", "止损", "止盈", "R:R", "开仓时间 (UTC)"],
    positions.map((pos, i) => {
      const entryMid = (pos.entryLow + pos.entryHigh) / 2;
      const risk     = Math.abs(entryMid - pos.stopLoss);
      const reward   = Math.abs(pos.takeProfit - entryMid);
      const rr       = risk > 0 ? (reward / risk).toFixed(1) : "–";

      const dirLabel = pos.direction === "long"
        ? green("多头 ▲")
        : red("空头 ▼");

      return {
        "#":            String(i + 1),
        方向:           dirLabel,
        品种:           pos.symbol,
        入场价:         `$${fmtPrice(entryMid)}`,
        止损:           red(`$${fmtPrice(pos.stopLoss)}`),
        止盈:           green(`$${fmtPrice(pos.takeProfit)}`),
        "R:R":          `1:${rr}`,
        "开仓时间 (UTC)": fmtTime(pos.openedAt),
      };
    })
  );

  console.log();
  console.log(dim("  注：入场价为区间中值。实时未实现盈亏每 30s 由仓位监控器计算。"));
  console.log();
}

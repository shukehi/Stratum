import Database from "better-sqlite3";
import { env } from "../app/env.js";
import {
  getOverallStats,
  getWinRateByGrade,
  getWinRateByDirection,
  getWinRateByStructureType,
  getExecutionFunnelStats,
  getOpenExposureByDirection,
  getRecentScanLogs,
  type WinRateRow,
  type ScanLogRow,
  type OpenExposureRow,
} from "../services/analytics/query-trade-report.js";
import {
  header, section, kv, fmtR, fmtPct, fmtTime, printTable, bold, dim, green, red, yellow, gray, HR
} from "./fmt.js";

/**
 * report 子命令 (V2 Physics)
 */
export async function cmdReport(args: string[], db: Database.Database): Promise<void> {
  const all       = args.includes("--all");
  const showGrade = all || args.includes("--grade");
  const showDir   = all || args.includes("--direction");
  const showStr   = all || args.includes("--structure");
  const showFunnel = all || args.includes("--funnel");
  const showRisk  = all || args.includes("--risk");
  const showLogs  = all || args.includes("--logs");
  const logLimit  = parseLogLimit(args) ?? 20;

  header("📊  Stratum 交易报告");
  console.log(dim(`  ${fmtTime(Date.now())}`));
  console.log();

  const s = getOverallStats(db, env.EXECUTION_MODE as "paper" | "live");

  if (s.totalScans === 0) {
    console.log(dim("  暂无扫描记录，请先运行 pnpm dev 积累数据。"));
    console.log();
    return;
  }

  kv("总扫描次数",      String(s.totalScans));
  kv("发送信号数",      String(s.totalSignalsSent));
  kv("已平仓笔数",      String(s.totalPositionsClosed));

  if (s.totalPositionsClosed > 0) {
    kv("胜率",   fmtPct(s.winRate));
    kv("平均盈亏", fmtR(s.avgPnlR));
    kv("累计总R", fmtR(s.totalR));
  } else {
    kv("已平仓笔数", dim("无（模拟仓位尚未触及 TP/SL）"));
  }

  console.log();

  // ── 按等级分析 ─────────────────────────────────────────────────────────────
  if (showGrade) {
    section("📈  按 CVS 动能分析");
    const rows = getWinRateByGrade(db, env.EXECUTION_MODE as "paper" | "live");
    if (rows.length === 0) {
      console.log(dim("  暂无数据"));
    } else {
      printTable(
        ["CVS", "笔数", "胜率", "平均R", "总R"],
        rows.map(winRateToRow)
      );
    }
  }

  // ── 方向分析 ───────────────────────────────────────────────────────────────
  if (showDir) {
    section("↔️  按多/空方向分析");
    const rows = getWinRateByDirection(db, env.EXECUTION_MODE as "paper" | "live");
    printTable(
      ["方向", "笔数", "胜率", "平均R", "总R"],
      rows.map(winRateToRow)
    );
  }

  // ── 结构分析 ───────────────────────────────────────────────────────────────
  if (showStr) {
    section("🏗️  按结构类型分析");
    const rows = getWinRateByStructureType(db, env.EXECUTION_MODE as "paper" | "live");
    printTable(
      ["结构", "笔数", "胜率", "平均R", "总R"],
      rows.map(winRateToRow)
    );
  }

  // ── 漏斗分析 ──────────────────────────────────────────────────────────────
  if (showFunnel) {
    section("🌪️  执行漏斗分析");
    const funnel = getExecutionFunnelStats(db);
    printTable(
      ["阶段", "数量"],
      [
        { "阶段": "已开仓", "数量": String(funnel.openPositions) },
        { "阶段": "已平仓", "数量": String(funnel.closedPositions) },
      ]
    );
  }

  // ── 风险暴露 ──────────────────────────────────────────────────────────────
  if (showRisk) {
    section("🛡️  当前风险暴露");
    const exposures = getOpenExposureByDirection(db, env.EXECUTION_MODE as "paper" | "live");
    if (exposures.length === 0) {
      console.log(dim("  当前无持仓"));
    } else {
      printTable(
        ["方向", "仓位数", "风险额(USD)", "风险占比"],
        exposures.map((e) => ({
          "方向": e.label,
          "仓位数": String(e.openCount),
          "风险额(USD)": `$${e.openRiskAmount.toFixed(2)}`,
          "风险占比": fmtPct(e.openRiskPercent),
        }))
      );
    }
  }

  // ── 最近日志 ───────────────────────────────────────────────────────────────
  if (showLogs) {
    section(`📋  最近 ${logLimit} 次扫描日志`);
    const logs = getRecentScanLogs(db, logLimit);
    printTable(
      ["时间", "品种", "状态", "OI Index", "信号", "Sent"],
      logs.map((l) => ({
        "时间": fmtTime(l.scannedAt),
        "品种": l.symbol,
        "状态": l.regime || "n/a",
        "OI Index": l.orderFlowBias || "n/a",
        "信号": String(l.candidatesFound),
        "Sent": String(l.alertsSent),
      }))
    );
  }

  console.log();
}

function winRateToRow(r: WinRateRow): Record<string, string> {
  return {
    "CVS": r.label,
    "方向": r.label,
    "结构": r.label,
    "笔数": String(r.count),
    "胜率": fmtPct(r.winRate),
    "平均R": fmtR(r.avgPnlR),
    "总R": fmtR(r.totalR),
  };
}

function parseLogLimit(args: string[]): number | null {
  const idx = args.indexOf("--logs");
  if (idx === -1) return null;
  const next = args[idx + 1];
  if (next && /^\d+$/.test(next)) return parseInt(next, 10);
  return null;
}

function fmtNumber(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

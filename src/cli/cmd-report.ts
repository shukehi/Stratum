import Database from "better-sqlite3";
import {
  getOverallStats,
  getWinRateByGrade,
  getWinRateByDirection,
  getWinRateByStructureType,
  getMacroFilterStats,
  getRecentScanLogs,
  type WinRateRow,
  type ScanLogRow,
} from "../services/analytics/query-trade-report.js";
import {
  header, section, kv, fmtR, fmtPct, fmtTime, printTable, bold, dim, green, red, yellow, gray, HR
} from "./fmt.js";

/**
 * report 子命令
 *
 * 用法：
 *   pnpm report                → 整体统计
 *   pnpm report --grade        → 按信号等级分析
 *   pnpm report --direction    → 按多/空方向分析
 *   pnpm report --structure    → 按结构类型分析
 *   pnpm report --macro        → 宏观过滤效果
 *   pnpm report --logs [N]     → 最近 N 次扫描日志（默认 20）
 *   pnpm report --all          → 显示全部内容
 */
export async function cmdReport(args: string[], db: Database.Database): Promise<void> {
  const all       = args.includes("--all");
  const showGrade = all || args.includes("--grade");
  const showDir   = all || args.includes("--direction");
  const showStr   = all || args.includes("--structure");
  const showMacro = all || args.includes("--macro");
  const showLogs  = all || args.includes("--logs");
  const logLimit  = parseLogLimit(args) ?? 20;

  header("📊  Stratum 交易报告");
  console.log(dim(`  ${fmtTime(Date.now())}`));
  console.log();

  // ── 整体统计（始终显示）────────────────────────────────────────────────────
  const s = getOverallStats(db);

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

  kv("宏观拦截次数", String(s.macroBlockCount));
  kv("宏观降级次数", String(s.macroDowngradeCount));

  // ── 按等级分析 ─────────────────────────────────────────────────────────────
  if (showGrade) {
    section("📈  按信号等级分析");
    const rows = getWinRateByGrade(db);
    if (rows.length === 0) {
      console.log(dim("  暂无数据"));
    } else {
      printTable(
        ["等级", "笔数", "胜率", "平均R", "总R"],
        rows.map(winRateToRow)
      );
    }
  }

  // ── 按方向分析 ─────────────────────────────────────────────────────────────
  if (showDir) {
    section("🔀  按方向分析（多头 vs 空头）");
    const rows = getWinRateByDirection(db);
    if (rows.length === 0) {
      console.log(dim("  暂无数据"));
    } else {
      printTable(
        ["方向", "笔数", "胜率", "平均R", "总R"],
        rows.map((r) => ({ ...winRateToRow(r), 方向: r.label === "long" ? "多头" : "空头" }))
      );
    }
  }

  // ── 按结构类型分析 ─────────────────────────────────────────────────────────
  if (showStr) {
    section("🏗️   按结构类型分析");
    const rows = getWinRateByStructureType(db);
    if (rows.length === 0) {
      console.log(dim("  暂无数据"));
    } else {
      printTable(
        ["结构类型", "笔数", "胜率", "平均R", "总R"],
        rows.map((r) => ({
          结构类型: r.label === "FVG" ? "FVG（公允价值缺口）" :
                   r.label === "LiquiditySweep" ? "流动性扫描" : "其他",
          ...winRateToRow(r),
        }))
      );
    }
  }

  // ── 宏观过滤效果 ───────────────────────────────────────────────────────────
  if (showMacro) {
    section("🔭  宏观过滤效果");
    const rows = getMacroFilterStats(db);
    if (rows.length === 0) {
      console.log(dim("  暂无数据"));
    } else {
      printTable(
        ["宏观动作", "扫描次数", "发现信号", "过滤信号"],
        rows.map((r) => ({
          宏观动作:  r.macroAction,
          扫描次数:  String(r.scanCount),
          发现信号:  String(r.totalCandidatesFound),
          过滤信号:  String(r.totalCandidatesBlocked),
        }))
      );
    }
  }

  // ── 扫描日志 ───────────────────────────────────────────────────────────────
  if (showLogs) {
    section(`📋  最近 ${logLimit} 次扫描日志`);
    const logs = getRecentScanLogs(db, logLimit);
    if (logs.length === 0) {
      console.log(dim("  暂无日志"));
    } else {
      printTable(
        ["时间 (UTC)", "品种", "信号", "过滤后", "发送", "宏观动作"],
        logs.map(scanLogToRow)
      );
    }
  }

  console.log();
  console.log(gray(HR));
  console.log(dim(`  使用 ${bold("pnpm report --all")} 显示完整分析`));
  console.log();
}

// ── 内部格式化 ────────────────────────────────────────────────────────────────

function winRateToRow(r: WinRateRow): Record<string, string> {
  return {
    等级:    r.label,
    方向:    r.label,
    结构类型: r.label,
    笔数:   String(r.total),
    胜率:   fmtPct(r.winRate),
    平均R:  fmtR(r.avgPnlR),
    总R:    fmtR(r.totalR),
  };
}

function scanLogToRow(r: ScanLogRow): Record<string, string> {
  const macroColor =
    r.macroAction === "block"     ? red(r.macroAction) :
    r.macroAction === "downgrade" ? yellow(r.macroAction) :
    r.macroAction;

  return {
    "时间 (UTC)": fmtTime(r.scannedAt),
    品种:         r.symbol,
    信号:         String(r.candidatesFound),
    过滤后:       String(r.candidatesAfterMacro),
    发送:         r.alertsSent > 0 ? green(String(r.alertsSent)) : String(r.alertsSent),
    宏观动作:     macroColor,
  };
}

function parseLogLimit(args: string[]): number | null {
  const idx = args.indexOf("--logs");
  if (idx === -1) return null;
  const next = args[idx + 1];
  if (next && /^\d+$/.test(next)) return parseInt(next, 10);
  return null;
}

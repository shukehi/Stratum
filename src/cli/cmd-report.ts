import {
  getOverallStats,
  getWinRateByGrade,
  getWinRateByDirection,
  getWinRateByStructureType,
  getExecutionFunnelStats,
  getPositionSizingStats,
  getOpenExposureByDirection,
  getRecentRiskSnapshots,
  getRecentScanLogs,
  getCandidateSnapshotBreakdownByExecutionOutcome,
  getCandidateSnapshotBreakdownByExecutionReason,
  getExecutionBreakdownByRegime,
  getExecutionBreakdownByParticipantPressure,
  getOutcomeBreakdownByRegime,
  getOutcomeBreakdownByParticipantPressure,
  getOutcomeBreakdownByDailyBias,
  getOutcomeBreakdownByOrderFlowBias,
  getOutcomeBreakdownByLiquiditySession,
  getOutcomeWindowRows,
  MIN_DECISIVE_CLOSED_TRADES_FOR_OUTCOME,
  type WinRateRow,
  type ScanLogRow,
  type OpenExposureRow,
  type ExecutionBreakdownRow,
  type OutcomeBreakdownRow,
  type OutcomeWindowRow,
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
 *   pnpm report --funnel       → 执行漏斗 / 失败原因
 *   pnpm report --risk         → 仓位建议 / 组合风险
 *   pnpm report --logs [N]     → 最近 N 次扫描日志（默认 20）
 *   pnpm report --all          → 显示全部内容
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
        ["宏观动作", "候选快照", "宏观拦截", "发送成功", "执行跳过/失败"],
        rows.map((r) => ({

          候选快照:  String(r.snapshotCount),
          宏观拦截:  String(r.blockedCount),
          发送成功:  String(r.sentCount),
          "执行跳过/失败": String(r.skippedOrFailedCount),
        }))
      );
    }
  }

  if (showFunnel) {
    section("🧭  执行漏斗");
    const funnel = getExecutionFunnelStats(db);
    const outcomeRows = getCandidateSnapshotBreakdownByExecutionOutcome(db);
    const reasonRows = getCandidateSnapshotBreakdownByExecutionReason(db);
    const regimeRows = getExecutionBreakdownByRegime(db);
    const participantRows = getExecutionBreakdownByParticipantPressure(db);
    const outcomeRegimeRows = getOutcomeBreakdownByRegime(db);
    const outcomeParticipantRows = getOutcomeBreakdownByParticipantPressure(db);
    const outcomeDailyBiasRows = getOutcomeBreakdownByDailyBias(db);
    const outcomeOrderFlowRows = getOutcomeBreakdownByOrderFlowBias(db);
    const outcomeSessionRows = getOutcomeBreakdownByLiquiditySession(db);
    const outcomeWindowRows = getOutcomeWindowRows(db);

    if (funnel.totalSnapshots === 0) {
      console.log(dim("  暂无候选快照"));
    } else {
      printTable(
        ["阶段", "数量", "占全部快照"],
        [
          funnelRow("候选快照", funnel.totalSnapshots, funnel.totalSnapshots),
          funnelRow("执行门控跳过", funnel.skippedExecutionGate, funnel.totalSnapshots),
          funnelRow("重复跳过", funnel.skippedDuplicate, funnel.totalSnapshots),
          funnelRow("发送失败", funnel.failed, funnel.totalSnapshots),
          funnelRow("发送成功", funnel.sent, funnel.totalSnapshots),
          funnelRow("成功入仓", funnel.opened, funnel.totalSnapshots),
        ]
      );
      console.log();
      kv("在途 open 仓位", String(funnel.openPositions));
      kv("已关闭仓位", String(funnel.closedPositions));
    }

    if (outcomeRows.length > 0) {
      console.log();
      printTable(
        ["执行结果", "数量"],
        outcomeRows.map((row) => ({
          执行结果: row.label,
          数量: String(row.total),
        }))
      );
    }

    const meaningfulReasons = reasonRows.filter((row) => row.label !== "none");
    if (meaningfulReasons.length > 0) {
      console.log();
      printTable(
        ["执行原因", "数量"],
        meaningfulReasons.map((row) => ({
          执行原因: row.label,
          数量: String(row.total),
        }))
      );
    }

    if (regimeRows.length > 0) {
      console.log();
      printTable(
        ["Regime", "快照", "Block", "Gate", "Dup", "Fail", "Sent", "Opened"],
        regimeRows.map((row) => executionBreakdownToRow("Regime", row))
      );
    }

    if (participantRows.length > 0) {
      console.log();
      printTable(
        ["Participant", "快照", "Block", "Gate", "Dup", "Fail", "Sent", "Opened"],
        participantRows.map((row) => executionBreakdownToRow("Participant", row))
      );
    }

    if (outcomeWindowRows.length > 0) {
      console.log();
      console.log(
        dim(
          `  Outcome stats need >= ${MIN_DECISIVE_CLOSED_TRADES_FOR_OUTCOME} decisive closed trades per bucket before they should be treated as stable.`
        )
      );
      printTable(
        ["Window", "Sent", "Opened", "Closed", "TP", "SL", "WinRate", "AvgR", "Sample"],
        outcomeWindowRows.map(outcomeWindowToRow)
      );
    }

    const meaningfulOutcomeRegimeRows = outcomeRegimeRows.filter((row) => row.sent > 0);
    if (meaningfulOutcomeRegimeRows.length > 0) {
      console.log();
      printTable(
        ["Regime", "Sent", "Open", "Closed", "TP", "SL", "WinRate", "AvgR", "Sample"],
        meaningfulOutcomeRegimeRows.map((row) => outcomeBreakdownToRow("Regime", row))
      );
    }

    const meaningfulOutcomeParticipantRows = outcomeParticipantRows.filter((row) => row.sent > 0);
    if (meaningfulOutcomeParticipantRows.length > 0) {
      console.log();
      printTable(
        ["Participant", "Sent", "Open", "Closed", "TP", "SL", "WinRate", "AvgR", "Sample"],
        meaningfulOutcomeParticipantRows.map((row) =>
          outcomeBreakdownToRow("Participant", row)
        )
      );
    }

    const meaningfulOutcomeDailyBiasRows = outcomeDailyBiasRows.filter((row) => row.sent > 0);
    if (meaningfulOutcomeDailyBiasRows.length > 0) {
      console.log();
      printTable(
        ["DailyBias", "Sent", "Open", "Closed", "TP", "SL", "WinRate", "AvgR", "Sample"],
        meaningfulOutcomeDailyBiasRows.map((row) => outcomeBreakdownToRow("DailyBias", row))
      );
    }

    const meaningfulOutcomeOrderFlowRows = outcomeOrderFlowRows.filter((row) => row.sent > 0);
    if (meaningfulOutcomeOrderFlowRows.length > 0) {
      console.log();
      printTable(
        ["OrderFlow", "Sent", "Open", "Closed", "TP", "SL", "WinRate", "AvgR", "Sample"],
        meaningfulOutcomeOrderFlowRows.map((row) => outcomeBreakdownToRow("OrderFlow", row))
      );
    }

    const meaningfulOutcomeSessionRows = outcomeSessionRows.filter((row) => row.sent > 0);
    if (meaningfulOutcomeSessionRows.length > 0) {
      console.log();
      printTable(
        ["Session", "Sent", "Open", "Closed", "TP", "SL", "WinRate", "AvgR", "Sample"],
        meaningfulOutcomeSessionRows.map((row) => outcomeBreakdownToRow("Session", row))
      );
    }
  }

  // ── 仓位建议 / 组合风险 ────────────────────────────────────────────────
  if (showRisk) {
    section("💼  仓位建议与组合风险");
    const sizing = getPositionSizingStats(db);
    const exposureRows = getOpenExposureByDirection(db);
    const snapshots = getRecentRiskSnapshots(db, 5);

    if (sizing.totalSnapshots === 0) {
      console.log(dim("  暂无风险快照"));
    } else {
      kv("风险快照数", String(sizing.totalSnapshots));
      kv("仓位建议覆盖率", fmtPct(sizing.sizingCoverage));
      kv("可计算仓位数", String(sizing.sizedSnapshots));
      kv("不可计算仓位数", String(sizing.unavailableSnapshots));
      kv("平均单笔风险", sizing.avgRiskAmount > 0 ? `$${fmtNumber(sizing.avgRiskAmount)}` : dim("不可用"));
      kv("平均建议仓位", sizing.avgRecommendedPositionSize > 0 ? `$${fmtNumber(sizing.avgRecommendedPositionSize)}` : dim("不可用"));
      kv("平均组合风险", fmtPct(sizing.avgProjectedPortfolioRiskPercent));
      kv("峰值组合风险", fmtPct(sizing.maxProjectedPortfolioRiskPercent));
    }

    if (exposureRows.length > 0) {
      console.log();
      printTable(
        ["方向", "开放仓位", "风险金额", "风险占比"],
        exposureRows.map(openExposureToRow)
      );
    }

    if (snapshots.length > 0) {
      console.log();
      printTable(
        ["时间 (UTC)", "品种", "方向", "执行结果", "宏观", "风险", "建议仓位", "组合风险"],
        snapshots.map((row) => ({
          "时间 (UTC)": fmtTime(row.createdAt),
          品种: row.symbol,
          方向: row.direction,
          执行结果: row.executionOutcome ?? row.alertStatus,

          风险: row.riskAmount !== null ? `$${fmtNumber(row.riskAmount)}` : "n/a",
          建议仓位: row.recommendedPositionSize !== null ? `$${fmtNumber(row.recommendedPositionSize)}` : "n/a",
          组合风险: row.projectedPortfolioRiskPercent !== null
            ? fmtPct(row.projectedPortfolioRiskPercent)
            : "n/a",
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





  return {
    "时间 (UTC)": fmtTime(r.scannedAt),
    品种:         r.symbol,
    信号:         String(r.candidatesFound),
    过滤后:       String(r.candidatesAfterMacro),
    发送:         r.alertsSent > 0 ? green(String(r.alertsSent)) : String(r.alertsSent),

  };
}

function openExposureToRow(r: OpenExposureRow): Record<string, string> {
  return {
    方向: r.label === "long" ? "多头" : r.label === "short" ? "空头" : r.label,
    开放仓位: String(r.openCount),
    风险金额: r.openRiskAmount > 0 ? `$${fmtNumber(r.openRiskAmount)}` : "$0",
    风险占比: fmtPct(r.openRiskPercent),
  };
}

function fmtNumber(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function funnelRow(
  label: string,
  count: number,
  total: number
): Record<string, string> {
  return {
    阶段: label,
    数量: String(count),
    占全部快照: total > 0 ? fmtPct(count / total) : "0.0%",
  };
}

function executionBreakdownToRow(
  columnLabel: "Regime" | "Participant",
  row: ExecutionBreakdownRow
): Record<string, string> {
  return {
    [columnLabel]: row.label,
    快照: String(row.totalSnapshots),
    Block: String(row.blockedByMacro),
    Gate: String(row.skippedExecutionGate),
    Dup: String(row.skippedDuplicate),
    Fail: String(row.failed),
    Sent: String(row.sent),
    Opened: String(row.opened),
  };
}

function outcomeBreakdownToRow(
  columnLabel: "Regime" | "Participant" | "DailyBias" | "OrderFlow" | "Session",
  row: OutcomeBreakdownRow
): Record<string, string> {
  return {
    [columnLabel]: row.label,
    Sent: String(row.sent),
    Open: String(row.openPositions),
    Closed: String(row.closedTrades),
    TP: String(row.wins),
    SL: String(row.losses),
    WinRate: formatOutcomeMetric(row.closedTrades > 0 ? fmtPct(row.winRate) : "n/a", row),
    AvgR: formatOutcomeMetric(row.closedTrades > 0 ? fmtR(row.avgPnlR) : "n/a", row),
    Sample: formatOutcomeSample(row),
  };
}

function outcomeWindowToRow(row: OutcomeWindowRow): Record<string, string> {
  return {
    Window: row.label,
    Sent: String(row.sent),
    Opened: String(row.opened),
    Closed: String(row.closedTrades),
    TP: String(row.wins),
    SL: String(row.losses),
    WinRate: formatOutcomeMetric(row.closedTrades > 0 ? fmtPct(row.winRate) : "n/a", row),
    AvgR: formatOutcomeMetric(row.closedTrades > 0 ? fmtR(row.avgPnlR) : "n/a", row),
    Sample: formatOutcomeSample(row),
  };
}

function formatOutcomeMetric(
  value: string,
  row: OutcomeBreakdownRow | OutcomeWindowRow
): string {
  if (row.sampleWarning === "no_decisive_closed_trades") return dim("n/a");
  if (row.sampleWarning === "low_sample") return yellow(`Low sample ${value}`);
  return value;
}

function formatOutcomeSample(
  row: OutcomeBreakdownRow | OutcomeWindowRow
): string {
  if (row.sampleWarning === "no_decisive_closed_trades") {
    return dim("No decisive closed trades");
  }
  if (row.sampleWarning === "low_sample") {
    return yellow(`${row.decisiveClosedTrades} / ${MIN_DECISIVE_CLOSED_TRADES_FOR_OUTCOME}`);
  }
  return green(`${row.decisiveClosedTrades}`);
}

function parseLogLimit(args: string[]): number | null {
  const idx = args.indexOf("--logs");
  if (idx === -1) return null;
  const next = args[idx + 1];
  if (next && /^\d+$/.test(next)) return parseInt(next, 10);
  return null;
}

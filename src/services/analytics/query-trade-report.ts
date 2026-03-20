import Database from "better-sqlite3";

/**
 * 交易日志分析查询  (PHASE_12)
 *
 * 所有函数均为纯 SQL 查询，无副作用。
 *
 * 核心关联：positions.id === candidates.id（相同主键格式）
 * 通过 JOIN 将交易结果（pnlR）与信号上下文（grade/regime/structure）关联。
 *
 * 使用场景：
 *   - 识别哪种信号等级胜率最高
 *   - 分析宏观过滤是否有效（block 的信号如果不过滤会怎样）
 *   - 统计扫描频率与信号质量趋势
 */

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export type WinRateRow = {
  label: string;
  total: number;
  wins: number;
  losses: number;
  winRate: number;
  avgPnlR: number;
  totalR: number;
};

export type ScanLogRow = {
  id: number;
  symbol: string;
  scannedAt: number;
  candidatesFound: number;
  candidatesAfterMacro: number;
  alertsSent: number;
  alertsFailed: number;
  alertsSkipped: number;
  macroAction: string;
  errorsCount: number;
};

export type OverallStats = {
  totalScans: number;
  totalSignalsSent: number;
  totalPositionsClosed: number;
  wins: number;
  losses: number;
  winRate: number;
  avgPnlR: number;
  totalR: number;
  macroBlockCount: number;
  macroDowngradeCount: number;
};

// ── 整体统计 ─────────────────────────────────────────────────────────────────

/**
 * 系统整体统计摘要
 */
export function getOverallStats(db: Database.Database): OverallStats {
  const scanRow = db.prepare(`
    SELECT
      COUNT(*) as totalScans,
      SUM(alerts_sent) as totalSignalsSent,
      SUM(CASE WHEN macro_action = 'block'     THEN 1 ELSE 0 END) as macroBlockCount,
      SUM(CASE WHEN macro_action = 'downgrade' THEN 1 ELSE 0 END) as macroDowngradeCount
    FROM scan_logs
  `).get() as {
    totalScans: number;
    totalSignalsSent: number;
    macroBlockCount: number;
    macroDowngradeCount: number;
  };

  const posRow = db.prepare(`
    SELECT
      COUNT(*) as totalClosed,
      SUM(CASE WHEN status = 'closed_tp' THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN status = 'closed_sl' THEN 1 ELSE 0 END) as losses,
      AVG(pnl_r) as avgPnlR,
      SUM(pnl_r) as totalR
    FROM positions
    WHERE status IN ('closed_tp', 'closed_sl')
  `).get() as {
    totalClosed: number;
    wins: number;
    losses: number;
    avgPnlR: number | null;
    totalR: number | null;
  };

  const closed = posRow.totalClosed ?? 0;
  const wins = posRow.wins ?? 0;

  return {
    totalScans: scanRow.totalScans ?? 0,
    totalSignalsSent: scanRow.totalSignalsSent ?? 0,
    totalPositionsClosed: closed,
    wins,
    losses: posRow.losses ?? 0,
    winRate: closed > 0 ? wins / closed : 0,
    avgPnlR: posRow.avgPnlR ?? 0,
    totalR: posRow.totalR ?? 0,
    macroBlockCount: scanRow.macroBlockCount ?? 0,
    macroDowngradeCount: scanRow.macroDowngradeCount ?? 0,
  };
}

// ── 按信号等级分组胜率 ─────────────────────────────────────────────────────

/**
 * 各信号等级（watch/standard/high-conviction）的胜率和平均 pnlR
 */
export function getWinRateByGrade(db: Database.Database): WinRateRow[] {
  const rows = db.prepare(`
    SELECT
      p.signal_grade                                          AS label,
      COUNT(*)                                               AS total,
      SUM(CASE WHEN p.status = 'closed_tp' THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN p.status = 'closed_sl' THEN 1 ELSE 0 END) AS losses,
      AVG(p.pnl_r)                                           AS avgPnlR,
      SUM(p.pnl_r)                                           AS totalR
    FROM positions p
    WHERE p.status IN ('closed_tp', 'closed_sl')
    GROUP BY p.signal_grade
    ORDER BY avgPnlR DESC
  `).all() as Array<{
    label: string; total: number; wins: number; losses: number;
    avgPnlR: number; totalR: number;
  }>;

  return rows.map((r) => ({
    ...r,
    winRate: r.total > 0 ? r.wins / r.total : 0,
  }));
}

// ── 按方向分组胜率 ────────────────────────────────────────────────────────────

/**
 * long vs short 胜率对比
 */
export function getWinRateByDirection(db: Database.Database): WinRateRow[] {
  const rows = db.prepare(`
    SELECT
      p.direction                                            AS label,
      COUNT(*)                                               AS total,
      SUM(CASE WHEN p.status = 'closed_tp' THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN p.status = 'closed_sl' THEN 1 ELSE 0 END) AS losses,
      AVG(p.pnl_r)                                           AS avgPnlR,
      SUM(p.pnl_r)                                           AS totalR
    FROM positions p
    WHERE p.status IN ('closed_tp', 'closed_sl')
    GROUP BY p.direction
  `).all() as Array<{
    label: string; total: number; wins: number; losses: number;
    avgPnlR: number; totalR: number;
  }>;

  return rows.map((r) => ({
    ...r,
    winRate: r.total > 0 ? r.wins / r.total : 0,
  }));
}

// ── 按结构原因分组（FVG vs 流动性扫描）─────────────────────────────────────

/**
 * 不同结构类型的胜率（关联 candidates 表）
 * 按 structure_reason 前缀分类（"看涨FVG" / "看涨流动性扫描" 等）
 */
export function getWinRateByStructureType(db: Database.Database): WinRateRow[] {
  const rows = db.prepare(`
    SELECT
      CASE
        WHEN c.structure_reason LIKE '%FVG%'      THEN 'FVG'
        WHEN c.structure_reason LIKE '%流动性扫描%' THEN 'LiquiditySweep'
        ELSE 'Other'
      END                                                    AS label,
      COUNT(*)                                               AS total,
      SUM(CASE WHEN p.status = 'closed_tp' THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN p.status = 'closed_sl' THEN 1 ELSE 0 END) AS losses,
      AVG(p.pnl_r)                                           AS avgPnlR,
      SUM(p.pnl_r)                                           AS totalR
    FROM positions p
    JOIN candidates c ON p.id = c.id
    WHERE p.status IN ('closed_tp', 'closed_sl')
    GROUP BY label
    ORDER BY avgPnlR DESC
  `).all() as Array<{
    label: string; total: number; wins: number; losses: number;
    avgPnlR: number; totalR: number;
  }>;

  return rows.map((r) => ({
    ...r,
    winRate: r.total > 0 ? r.wins / r.total : 0,
  }));
}

// ── 扫描日志查询 ─────────────────────────────────────────────────────────────

/**
 * 最近 N 次扫描记录（默认 50 条）
 */
export function getRecentScanLogs(
  db: Database.Database,
  limit = 50
): ScanLogRow[] {
  return (db.prepare(`
    SELECT
      id, symbol, scanned_at, candidates_found, candidates_after_macro,
      alerts_sent, alerts_failed, alerts_skipped, macro_action, errors_count
    FROM scan_logs
    ORDER BY scanned_at DESC
    LIMIT ?
  `).all(limit) as Array<{
    id: number; symbol: string; scanned_at: number;
    candidates_found: number; candidates_after_macro: number;
    alerts_sent: number; alerts_failed: number; alerts_skipped: number;
    macro_action: string; errors_count: number;
  }>).map((r) => ({
    id: r.id,
    symbol: r.symbol,
    scannedAt: r.scanned_at,
    candidatesFound: r.candidates_found,
    candidatesAfterMacro: r.candidates_after_macro,
    alertsSent: r.alerts_sent,
    alertsFailed: r.alerts_failed,
    alertsSkipped: r.alerts_skipped,
    macroAction: r.macro_action,
    errorsCount: r.errors_count,
  }));
}

// ── 宏观过滤效果分析 ─────────────────────────────────────────────────────────

/**
 * 宏观过滤统计：block/downgrade/pass 各占比及对应信号数
 */
export function getMacroFilterStats(db: Database.Database): Array<{
  macroAction: string;
  scanCount: number;
  totalCandidatesFound: number;
  totalCandidatesBlocked: number;
}> {
  return (db.prepare(`
    SELECT
      macro_action                                                  AS macroAction,
      COUNT(*)                                                      AS scanCount,
      SUM(candidates_found)                                         AS totalCandidatesFound,
      SUM(candidates_found - candidates_after_macro)                AS totalCandidatesBlocked
    FROM scan_logs
    GROUP BY macro_action
    ORDER BY scanCount DESC
  `).all() as Array<{
    macroAction: string;
    scanCount: number;
    totalCandidatesFound: number;
    totalCandidatesBlocked: number;
  }>);
}

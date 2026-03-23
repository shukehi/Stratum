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
  alertsSent: number;
  alertsFailed: number;
  alertsSkipped: number;
  errorsCount: number;
  skipStage: string | null;
  skipReasonCode: string | null;
  regime: string | null;
  participantPressureType: string | null;
  dailyBias: string | null;
  orderFlowBias: string | null;
  basisDivergence: boolean;
  marketDriverType: string | null;
  liquiditySession: string | null;
};

export type BreakdownRow = {
  label: string;
  total: number;
};

  snapshotCount: number;
  sentCount: number;
  skippedOrFailedCount: number;
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
};

export type PositionSizingStats = {
  totalSnapshots: number;
  sizedSnapshots: number;
  unavailableSnapshots: number;
  sizingCoverage: number;
  avgRiskAmount: number;
  avgRecommendedPositionSize: number;
  avgProjectedPortfolioRiskPercent: number;
  maxProjectedPortfolioRiskPercent: number;
};

export type OpenExposureRow = {
  label: string;
  openCount: number;
  openRiskAmount: number;
  openRiskPercent: number;
};

export type RiskSnapshotRow = {
  symbol: string;
  direction: string;
  alertStatus: string;
  executionOutcome: string | null;
  executionReasonCode: string | null;
  riskAmount: number | null;
  recommendedPositionSize: number | null;
  sameDirectionExposureCount: number | null;
  projectedPortfolioRiskPercent: number | null;
  createdAt: number;
};

export type ExecutionFunnelStats = {
  totalSnapshots: number;
  skippedExecutionGate: number;
  skippedDuplicate: number;
  failed: number;
  sent: number;
  opened: number;
  openPositions: number;
  closedPositions: number;
};

export type ExecutionBreakdownRow = {
  label: string;
  totalSnapshots: number;
  skippedExecutionGate: number;
  skippedDuplicate: number;
  failed: number;
  sent: number;
  opened: number;
};

export type OutcomeWindowRow = {
  label: string;
  sent: number;
  opened: number;
  closedTrades: number;
  decisiveClosedTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgPnlR: number;
  totalR: number;
  sampleAdequate: boolean;
  sampleWarning: "low_sample" | "no_decisive_closed_trades" | null;
};

export type OutcomeBreakdownRow = {
  label: string;
  sent: number;
  opened: number;
  openPositions: number;
  closedTrades: number;
  decisiveClosedTrades: number;
  wins: number;
  losses: number;
  manualCloses: number;
  winRate: number;
  avgPnlR: number;
  totalR: number;
  sampleAdequate: boolean;
  sampleWarning: "low_sample" | "no_decisive_closed_trades" | null;
};

export const MIN_DECISIVE_CLOSED_TRADES_FOR_OUTCOME = 5;

// ── 整体统计 ─────────────────────────────────────────────────────────────────

/**
 * 系统整体统计摘要
 */
export function getOverallStats(db: Database.Database): OverallStats {
  const scanRow = db.prepare(`
    SELECT
      COUNT(*) as totalScans,
      SUM(alerts_sent) as totalSignalsSent,
    FROM scan_logs
  `).get() as {
    totalScans: number;
    totalSignalsSent: number;
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
      skip_stage, skip_reason_code, regime, participant_pressure_type,
      daily_bias, order_flow_bias, basis_divergence, market_driver_type, liquidity_session
    FROM scan_logs
    ORDER BY scanned_at DESC
    LIMIT ?
  `).all(limit) as Array<{
    id: number; symbol: string; scanned_at: number;
    alerts_sent: number; alerts_failed: number; alerts_skipped: number;
    skip_stage: string | null; skip_reason_code: string | null;
    regime: string | null; participant_pressure_type: string | null;
    daily_bias: string | null; order_flow_bias: string | null;
    basis_divergence: number; market_driver_type: string | null; liquidity_session: string | null;
  }>).map((r) => ({
    id: r.id,
    symbol: r.symbol,
    scannedAt: r.scanned_at,
    candidatesFound: r.candidates_found,
    alertsSent: r.alerts_sent,
    alertsFailed: r.alerts_failed,
    alertsSkipped: r.alerts_skipped,
    errorsCount: r.errors_count,
    skipStage: r.skip_stage,
    skipReasonCode: r.skip_reason_code,
    regime: r.regime,
    participantPressureType: r.participant_pressure_type,
    dailyBias: r.daily_bias,
    orderFlowBias: r.order_flow_bias,
    basisDivergence: r.basis_divergence === 1,
    marketDriverType: r.market_driver_type,
    liquiditySession: r.liquidity_session,
  }));
}

// ── 宏观过滤效果分析 ─────────────────────────────────────────────────────────

/**
 * 宏观过滤统计：block/downgrade/pass 各占比及对应信号数
 */
  return (db.prepare(`
    SELECT
      COUNT(*)                                                      AS snapshotCount,
      SUM(CASE WHEN execution_outcome = 'sent' THEN 1 ELSE 0 END) AS sentCount,
      SUM(
        CASE
          WHEN execution_outcome IN ('skipped_execution_gate', 'skipped_duplicate', 'failed')
          THEN 1
          ELSE 0
        END
      ) AS skippedOrFailedCount
    FROM candidate_snapshots
}

export function getPositionSizingStats(
  db: Database.Database
): PositionSizingStats {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS totalSnapshots,
      SUM(CASE WHEN recommended_position_size IS NOT NULL THEN 1 ELSE 0 END) AS sizedSnapshots,
      SUM(CASE WHEN recommended_position_size IS NULL THEN 1 ELSE 0 END) AS unavailableSnapshots,
      AVG(risk_amount) AS avgRiskAmount,
      AVG(recommended_position_size) AS avgRecommendedPositionSize,
      AVG(projected_portfolio_risk_percent) AS avgProjectedPortfolioRiskPercent,
      MAX(projected_portfolio_risk_percent) AS maxProjectedPortfolioRiskPercent
    FROM candidate_snapshots
  `).get() as {
    totalSnapshots: number;
    sizedSnapshots: number | null;
    unavailableSnapshots: number | null;
    avgRiskAmount: number | null;
    avgRecommendedPositionSize: number | null;
    avgProjectedPortfolioRiskPercent: number | null;
    maxProjectedPortfolioRiskPercent: number | null;
  };

  const totalSnapshots = row.totalSnapshots ?? 0;
  const sizedSnapshots = row.sizedSnapshots ?? 0;

  return {
    totalSnapshots,
    sizedSnapshots,
    unavailableSnapshots: row.unavailableSnapshots ?? 0,
    sizingCoverage: totalSnapshots > 0 ? sizedSnapshots / totalSnapshots : 0,
    avgRiskAmount: row.avgRiskAmount ?? 0,
    avgRecommendedPositionSize: row.avgRecommendedPositionSize ?? 0,
    avgProjectedPortfolioRiskPercent: row.avgProjectedPortfolioRiskPercent ?? 0,
    maxProjectedPortfolioRiskPercent: row.maxProjectedPortfolioRiskPercent ?? 0,
  };
}

export function getOpenExposureByDirection(
  db: Database.Database
): OpenExposureRow[] {
  return (db.prepare(`
    SELECT
      direction AS label,
      COUNT(*) AS openCount,
      COALESCE(SUM(risk_amount), 0) AS openRiskAmount,
      COALESCE(SUM(account_risk_percent), 0) AS openRiskPercent
    FROM positions
    WHERE status = 'open'
    GROUP BY direction
    ORDER BY openCount DESC, direction ASC
  `).all() as Array<{
    label: string;
    openCount: number;
    openRiskAmount: number;
    openRiskPercent: number;
  }>);
}

export function getRecentRiskSnapshots(
  db: Database.Database,
  limit = 10
): RiskSnapshotRow[] {
  return db.prepare(`
    SELECT
      symbol,
      direction,
      alert_status AS alertStatus,
      execution_outcome AS executionOutcome,
      execution_reason_code AS executionReasonCode,
      risk_amount AS riskAmount,
      recommended_position_size AS recommendedPositionSize,
      same_direction_exposure_count AS sameDirectionExposureCount,
      projected_portfolio_risk_percent AS projectedPortfolioRiskPercent,
      created_at AS createdAt
    FROM candidate_snapshots
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(limit) as RiskSnapshotRow[];
}

export function getExecutionFunnelStats(
  db: Database.Database
): ExecutionFunnelStats {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS totalSnapshots,
      SUM(CASE WHEN execution_outcome = 'skipped_execution_gate' THEN 1 ELSE 0 END) AS skippedExecutionGate,
      SUM(CASE WHEN execution_outcome = 'skipped_duplicate' THEN 1 ELSE 0 END) AS skippedDuplicate,
      SUM(CASE WHEN execution_outcome = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN execution_outcome = 'sent' THEN 1 ELSE 0 END) AS sent,
      SUM(
        CASE
          WHEN execution_outcome = 'sent'
           AND EXISTS (
             SELECT 1
             FROM positions p
             WHERE p.id = candidate_snapshots.base_candidate_id
           )
          THEN 1
          ELSE 0
        END
      ) AS opened,
      SUM(
        CASE
          WHEN execution_outcome = 'sent'
           AND EXISTS (
             SELECT 1
             FROM positions p
             WHERE p.id = candidate_snapshots.base_candidate_id
               AND p.status = 'open'
           )
          THEN 1
          ELSE 0
        END
      ) AS openPositions,
      SUM(
        CASE
          WHEN execution_outcome = 'sent'
           AND EXISTS (
             SELECT 1
             FROM positions p
             WHERE p.id = candidate_snapshots.base_candidate_id
               AND p.status != 'open'
           )
          THEN 1
          ELSE 0
        END
      ) AS closedPositions
    FROM candidate_snapshots
  `).get() as {
    totalSnapshots: number | null;
    skippedExecutionGate: number | null;
    skippedDuplicate: number | null;
    failed: number | null;
    sent: number | null;
    opened: number | null;
    openPositions: number | null;
    closedPositions: number | null;
  };

  return {
    totalSnapshots: row.totalSnapshots ?? 0,
    skippedExecutionGate: row.skippedExecutionGate ?? 0,
    skippedDuplicate: row.skippedDuplicate ?? 0,
    failed: row.failed ?? 0,
    sent: row.sent ?? 0,
    opened: row.opened ?? 0,
    openPositions: row.openPositions ?? 0,
    closedPositions: row.closedPositions ?? 0,
  };
}

export function getScanBreakdownByRegime(db: Database.Database): BreakdownRow[] {
  return getBreakdownRows(db, `
    SELECT COALESCE(regime, 'unknown') AS label, COUNT(*) AS total
    FROM scan_logs
    GROUP BY COALESCE(regime, 'unknown')
    ORDER BY total DESC, label ASC
  `);
}

export function getScanBreakdownByParticipantPressure(db: Database.Database): BreakdownRow[] {
  return getBreakdownRows(db, `
    SELECT COALESCE(participant_pressure_type, 'unknown') AS label, COUNT(*) AS total
    FROM scan_logs
    GROUP BY COALESCE(participant_pressure_type, 'unknown')
    ORDER BY total DESC, label ASC
  `);
}

export function getScanBreakdownBySkipStage(db: Database.Database): BreakdownRow[] {
  return getBreakdownRows(db, `
    SELECT COALESCE(skip_stage, 'none') AS label, COUNT(*) AS total
    FROM scan_logs
    GROUP BY COALESCE(skip_stage, 'none')
    ORDER BY total DESC, label ASC
  `);
}

export function getCandidateSnapshotBreakdownByMacroAction(
  db: Database.Database
): BreakdownRow[] {
  return getBreakdownRows(db, `
    FROM candidate_snapshots
    ORDER BY total DESC, label ASC
  `);
}

export function getCandidateSnapshotBreakdownByConfirmationStatus(
  db: Database.Database
): BreakdownRow[] {
  return getBreakdownRows(db, `
    SELECT COALESCE(confirmation_status, 'unknown') AS label, COUNT(*) AS total
    FROM candidate_snapshots
    GROUP BY COALESCE(confirmation_status, 'unknown')
    ORDER BY total DESC, label ASC
  `);
}

export function getCandidateSnapshotBreakdownByExecutionOutcome(
  db: Database.Database
): BreakdownRow[] {
  return getBreakdownRows(db, `
    SELECT COALESCE(execution_outcome, 'unknown') AS label, COUNT(*) AS total
    FROM candidate_snapshots
    GROUP BY COALESCE(execution_outcome, 'unknown')
    ORDER BY total DESC, label ASC
  `);
}

export function getCandidateSnapshotBreakdownByExecutionReason(
  db: Database.Database
): BreakdownRow[] {
  return getBreakdownRows(db, `
    SELECT COALESCE(execution_reason_code, 'none') AS label, COUNT(*) AS total
    FROM candidate_snapshots
    GROUP BY COALESCE(execution_reason_code, 'none')
    ORDER BY total DESC, label ASC
  `);
}

export function getExecutionBreakdownByRegime(
  db: Database.Database
): ExecutionBreakdownRow[] {
  return getExecutionBreakdownRows(db, "COALESCE(regime, 'unknown')");
}

export function getExecutionBreakdownByParticipantPressure(
  db: Database.Database
): ExecutionBreakdownRow[] {
  return getExecutionBreakdownRows(
    db,
    "COALESCE(participant_pressure_type, 'unknown')"
  );
}

export function getExecutionBreakdownByMacroAction(
  db: Database.Database
): ExecutionBreakdownRow[] {
}

export function getOutcomeBreakdownByRegime(
  db: Database.Database
): OutcomeBreakdownRow[] {
  return getOutcomeBreakdownRows(db, "COALESCE(regime, 'unknown')");
}

export function getOutcomeBreakdownByParticipantPressure(
  db: Database.Database
): OutcomeBreakdownRow[] {
  return getOutcomeBreakdownRows(
    db,
    "COALESCE(participant_pressure_type, 'unknown')"
  );
}

export function getOutcomeBreakdownByMacroAction(
  db: Database.Database
): OutcomeBreakdownRow[] {
}

export function getOutcomeBreakdownByDailyBias(
  db: Database.Database
): OutcomeBreakdownRow[] {
  return getOutcomeBreakdownRows(db, "COALESCE(daily_bias, 'unknown')");
}

export function getOutcomeBreakdownByOrderFlowBias(
  db: Database.Database
): OutcomeBreakdownRow[] {
  return getOutcomeBreakdownRows(db, "COALESCE(order_flow_bias, 'unknown')");
}

export function getOutcomeBreakdownByLiquiditySession(
  db: Database.Database
): OutcomeBreakdownRow[] {
  return getOutcomeBreakdownRows(db, "COALESCE(liquidity_session, 'unknown')");
}

export function getOutcomeWindowRows(
  db: Database.Database,
  now: number = Date.now()
): OutcomeWindowRow[] {
  return [
    buildOutcomeWindowRow(db, "All-time"),
    buildOutcomeWindowRow(db, "Last 7d", now - 7 * 24 * 60 * 60 * 1000),
  ];
}

function getBreakdownRows(db: Database.Database, sql: string): BreakdownRow[] {
  return db.prepare(sql).all() as BreakdownRow[];
}

function getExecutionBreakdownRows(
  db: Database.Database,
  labelExpr: string
): ExecutionBreakdownRow[] {
  return db.prepare(`
    SELECT
      ${labelExpr} AS label,
      COUNT(*) AS totalSnapshots,
      SUM(CASE WHEN execution_outcome = 'skipped_execution_gate' THEN 1 ELSE 0 END) AS skippedExecutionGate,
      SUM(CASE WHEN execution_outcome = 'skipped_duplicate' THEN 1 ELSE 0 END) AS skippedDuplicate,
      SUM(CASE WHEN execution_outcome = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN execution_outcome = 'sent' THEN 1 ELSE 0 END) AS sent,
      SUM(
        CASE
          WHEN execution_outcome = 'sent'
           AND EXISTS (
             SELECT 1
             FROM positions p
             WHERE p.id = candidate_snapshots.base_candidate_id
           )
          THEN 1
          ELSE 0
        END
      ) AS opened
    FROM candidate_snapshots
    GROUP BY ${labelExpr}
    ORDER BY totalSnapshots DESC, label ASC
  `).all() as ExecutionBreakdownRow[];
}

function getOutcomeBreakdownRows(
  db: Database.Database,
  labelExpr: string
): OutcomeBreakdownRow[] {
  return (db.prepare(`
    SELECT
      ${labelExpr} AS label,
      SUM(CASE WHEN candidate_snapshots.execution_outcome = 'sent' THEN 1 ELSE 0 END) AS sent,
      SUM(
        CASE
          WHEN candidate_snapshots.execution_outcome = 'sent'
           AND positions.id IS NOT NULL
          THEN 1
          ELSE 0
        END
      ) AS opened,
      SUM(
        CASE
          WHEN candidate_snapshots.execution_outcome = 'sent'
           AND positions.status = 'open'
          THEN 1
          ELSE 0
        END
      ) AS openPositions,
      SUM(
        CASE
          WHEN candidate_snapshots.execution_outcome = 'sent'
           AND positions.status IN ('closed_tp', 'closed_sl', 'closed_manual')
          THEN 1
          ELSE 0
        END
      ) AS closedTrades,
      SUM(
        CASE
          WHEN candidate_snapshots.execution_outcome = 'sent'
           AND positions.status = 'closed_tp'
          THEN 1
          ELSE 0
        END
      ) AS wins,
      SUM(
        CASE
          WHEN candidate_snapshots.execution_outcome = 'sent'
           AND positions.status = 'closed_sl'
          THEN 1
          ELSE 0
        END
      ) AS losses,
      SUM(
        CASE
          WHEN candidate_snapshots.execution_outcome = 'sent'
           AND positions.status = 'closed_manual'
          THEN 1
          ELSE 0
        END
      ) AS manualCloses,
      AVG(
        CASE
          WHEN candidate_snapshots.execution_outcome = 'sent'
           AND positions.status IN ('closed_tp', 'closed_sl', 'closed_manual')
          THEN positions.pnl_r
        END
      ) AS avgPnlR,
      SUM(
        CASE
          WHEN candidate_snapshots.execution_outcome = 'sent'
           AND positions.status IN ('closed_tp', 'closed_sl', 'closed_manual')
          THEN positions.pnl_r
          ELSE 0
        END
      ) AS totalR
    FROM candidate_snapshots
    LEFT JOIN positions
      ON positions.id = candidate_snapshots.base_candidate_id
    GROUP BY ${labelExpr}
    ORDER BY sent DESC, label ASC
  `).all() as Array<{
    label: string;
    sent: number | null;
    opened: number | null;
    openPositions: number | null;
    closedTrades: number | null;
    wins: number | null;
    losses: number | null;
    manualCloses: number | null;
    avgPnlR: number | null;
    totalR: number | null;
  }>).map((row) => {
    const wins = row.wins ?? 0;
    const losses = row.losses ?? 0;
    const decisiveClosed = wins + losses;
    const sampleWarning = inferOutcomeSampleWarning(decisiveClosed);
    return {
      label: row.label,
      sent: row.sent ?? 0,
      opened: row.opened ?? 0,
      openPositions: row.openPositions ?? 0,
      closedTrades: row.closedTrades ?? 0,
      decisiveClosedTrades: decisiveClosed,
      wins,
      losses,
      manualCloses: row.manualCloses ?? 0,
      winRate: decisiveClosed > 0 ? wins / decisiveClosed : 0,
      avgPnlR: row.avgPnlR ?? 0,
      totalR: row.totalR ?? 0,
      sampleAdequate: sampleWarning === null,
      sampleWarning,
    };
  });
}

function buildOutcomeWindowRow(
  db: Database.Database,
  label: string,
  since?: number
): OutcomeWindowRow {
  const whereClause = since !== undefined ? "WHERE candidate_snapshots.created_at >= ?" : "";
  const sql = `
    SELECT
      SUM(CASE WHEN candidate_snapshots.execution_outcome = 'sent' THEN 1 ELSE 0 END) AS sent,
      SUM(
        CASE
          WHEN candidate_snapshots.execution_outcome = 'sent'
           AND positions.id IS NOT NULL
          THEN 1
          ELSE 0
        END
      ) AS opened,
      SUM(
        CASE
          WHEN candidate_snapshots.execution_outcome = 'sent'
           AND positions.status IN ('closed_tp', 'closed_sl', 'closed_manual')
          THEN 1
          ELSE 0
        END
      ) AS closedTrades,
      SUM(
        CASE
          WHEN candidate_snapshots.execution_outcome = 'sent'
           AND positions.status = 'closed_tp'
          THEN 1
          ELSE 0
        END
      ) AS wins,
      SUM(
        CASE
          WHEN candidate_snapshots.execution_outcome = 'sent'
           AND positions.status = 'closed_sl'
          THEN 1
          ELSE 0
        END
      ) AS losses,
      AVG(
        CASE
          WHEN candidate_snapshots.execution_outcome = 'sent'
           AND positions.status IN ('closed_tp', 'closed_sl', 'closed_manual')
          THEN positions.pnl_r
        END
      ) AS avgPnlR,
      SUM(
        CASE
          WHEN candidate_snapshots.execution_outcome = 'sent'
           AND positions.status IN ('closed_tp', 'closed_sl', 'closed_manual')
          THEN positions.pnl_r
          ELSE 0
        END
      ) AS totalR
    FROM candidate_snapshots
    LEFT JOIN positions
      ON positions.id = candidate_snapshots.base_candidate_id
    ${whereClause}
  `;
  const row = (since !== undefined
    ? db.prepare(sql).get(since)
    : db.prepare(sql).get()) as {
    sent: number | null;
    opened: number | null;
    closedTrades: number | null;
    wins: number | null;
    losses: number | null;
    avgPnlR: number | null;
    totalR: number | null;
  };
  const wins = row.wins ?? 0;
  const losses = row.losses ?? 0;
  const decisiveClosed = wins + losses;
  const sampleWarning = inferOutcomeSampleWarning(decisiveClosed);

  return {
    label,
    sent: row.sent ?? 0,
    opened: row.opened ?? 0,
    closedTrades: row.closedTrades ?? 0,
    decisiveClosedTrades: decisiveClosed,
    wins,
    losses,
    winRate: decisiveClosed > 0 ? wins / decisiveClosed : 0,
    avgPnlR: row.avgPnlR ?? 0,
    totalR: row.totalR ?? 0,
    sampleAdequate: sampleWarning === null,
    sampleWarning,
  };
}

function inferOutcomeSampleWarning(
  decisiveClosedTrades: number
): "low_sample" | "no_decisive_closed_trades" | null {
  if (decisiveClosedTrades === 0) return "no_decisive_closed_trades";
  if (decisiveClosedTrades < MIN_DECISIVE_CLOSED_TRADES_FOR_OUTCOME) {
    return "low_sample";
  }
  return null;
}

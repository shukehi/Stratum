import Database from "better-sqlite3";
import { initPositionsDb } from "../positions/init-positions-db.js";

/**
 * 数据库初始化  (PHASE_08)
 *
 * 负责创建扫描日志、候选信号、K 线缓存、候选快照等核心表。
 * 候选信号使用确定性主键：
 *   `symbol + direction + timeframe + floor(entryHigh)`
 *
 * 同一信号被重复评估时会覆盖旧记录，而不是写出重复候选。
 */
export function initDb(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scan_logs (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol                 TEXT    NOT NULL,
      scanned_at             INTEGER NOT NULL,
      candidates_found       INTEGER NOT NULL DEFAULT 0,
      candidates_after_macro INTEGER NOT NULL DEFAULT 0,
      alerts_sent            INTEGER NOT NULL DEFAULT 0,
      alerts_failed          INTEGER NOT NULL DEFAULT 0,
      alerts_skipped         INTEGER NOT NULL DEFAULT 0,
      macro_action           TEXT    NOT NULL DEFAULT 'pass',
      errors_count           INTEGER NOT NULL DEFAULT 0,
      errors_json            TEXT    NOT NULL DEFAULT '[]'
    );

    CREATE INDEX IF NOT EXISTS idx_scan_logs_symbol
      ON scan_logs(symbol);

    CREATE INDEX IF NOT EXISTS idx_scan_logs_scanned_at
      ON scan_logs(scanned_at);

    CREATE TABLE IF NOT EXISTS candidates (
      id               TEXT    PRIMARY KEY,
      symbol           TEXT    NOT NULL,
      direction        TEXT    NOT NULL,
      timeframe        TEXT    NOT NULL,
      entry_low        REAL    NOT NULL,
      entry_high       REAL    NOT NULL,
      stop_loss        REAL    NOT NULL,
      take_profit      REAL    NOT NULL,
      risk_reward      REAL    NOT NULL,
      signal_grade     TEXT    NOT NULL,
      regime_aligned   INTEGER NOT NULL,
      participant_aligned INTEGER NOT NULL,
      structure_reason TEXT    NOT NULL,
      context_reason   TEXT    NOT NULL,
      macro_reason     TEXT,
      reason_codes     TEXT    NOT NULL,
      alert_status     TEXT    NOT NULL DEFAULT 'pending',
      recommended_position_size REAL,
      recommended_base_size REAL,
      risk_amount      REAL,
      account_risk_percent REAL,
      same_direction_exposure_count INTEGER,
      same_direction_exposure_risk_percent REAL,
      projected_same_direction_risk_percent REAL,
      portfolio_open_risk_percent REAL,
      projected_portfolio_risk_percent REAL,
      created_at       INTEGER NOT NULL,
      updated_at       INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_candidates_symbol
      ON candidates(symbol);

    CREATE INDEX IF NOT EXISTS idx_candidates_created_at
      ON candidates(created_at);

    CREATE TABLE IF NOT EXISTS candles (
      symbol    TEXT    NOT NULL,
      timeframe TEXT    NOT NULL,
      timestamp INTEGER NOT NULL,
      open      REAL    NOT NULL,
      high      REAL    NOT NULL,
      low       REAL    NOT NULL,
      close     REAL    NOT NULL,
      volume    REAL    NOT NULL,
      PRIMARY KEY (symbol, timeframe, timestamp)
    );

    CREATE INDEX IF NOT EXISTS idx_candles_lookup
      ON candles (symbol, timeframe, timestamp DESC);

    CREATE TABLE IF NOT EXISTS candidate_snapshots (
      id                        INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id              TEXT    NOT NULL,
      base_candidate_id         TEXT    NOT NULL,
      symbol                    TEXT    NOT NULL,
      direction                 TEXT    NOT NULL,
      timeframe                 TEXT    NOT NULL,
      entry_low                 REAL    NOT NULL,
      entry_high                REAL    NOT NULL,
      stop_loss                 REAL    NOT NULL,
      take_profit               REAL    NOT NULL,
      risk_reward               REAL    NOT NULL,
      signal_grade              TEXT    NOT NULL,
      regime_aligned            INTEGER NOT NULL,
      participant_aligned       INTEGER NOT NULL,
      structure_reason          TEXT    NOT NULL,
      context_reason            TEXT    NOT NULL,
      macro_reason              TEXT,
      reason_codes              TEXT    NOT NULL,
      alert_status              TEXT    NOT NULL DEFAULT 'pending',
      macro_action              TEXT,
      confirmation_status       TEXT,
      recommended_position_size REAL,
      recommended_base_size     REAL,
      risk_amount               REAL,
      account_risk_percent      REAL,
      same_direction_exposure_count INTEGER,
      same_direction_exposure_risk_percent REAL,
      projected_same_direction_risk_percent REAL,
      portfolio_open_risk_percent REAL,
      projected_portfolio_risk_percent REAL,
      daily_bias                TEXT,
      order_flow_bias           TEXT,
      regime                    TEXT,
      regime_confidence         REAL,
      market_driver_type        TEXT,
      participant_bias          TEXT,
      participant_pressure_type TEXT,
      participant_confidence    REAL,
      basis_divergence          INTEGER NOT NULL DEFAULT 0,
      liquidity_session         TEXT,
      execution_outcome         TEXT,
      execution_reason_code     TEXT,
      created_at                INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_candidate_snapshots_symbol
      ON candidate_snapshots(symbol, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_candidate_snapshots_macro_action
      ON candidate_snapshots(macro_action, created_at DESC);
  `);

  ensureColumn(db, "scan_logs", "skip_stage", "TEXT");
  ensureColumn(db, "scan_logs", "skip_reason_code", "TEXT");
  ensureColumn(db, "scan_logs", "regime", "TEXT");
  ensureColumn(db, "scan_logs", "participant_pressure_type", "TEXT");
  ensureColumn(db, "scan_logs", "daily_bias", "TEXT");
  ensureColumn(db, "scan_logs", "order_flow_bias", "TEXT");
  ensureColumn(db, "scan_logs", "basis_divergence", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "scan_logs", "market_driver_type", "TEXT");
  ensureColumn(db, "scan_logs", "liquidity_session", "TEXT");

  ensureColumn(db, "candidates", "macro_action", "TEXT");
  ensureColumn(db, "candidates", "confirmation_status", "TEXT");
  ensureColumn(db, "candidates", "daily_bias", "TEXT");
  ensureColumn(db, "candidates", "order_flow_bias", "TEXT");
  ensureColumn(db, "candidates", "regime", "TEXT");
  ensureColumn(db, "candidates", "regime_confidence", "REAL");
  ensureColumn(db, "candidates", "market_driver_type", "TEXT");
  ensureColumn(db, "candidates", "participant_bias", "TEXT");
  ensureColumn(db, "candidates", "participant_pressure_type", "TEXT");
  ensureColumn(db, "candidates", "participant_confidence", "REAL");
  ensureColumn(db, "candidates", "basis_divergence", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "candidates", "liquidity_session", "TEXT");
  ensureColumn(db, "candidates", "recommended_position_size", "REAL");
  ensureColumn(db, "candidates", "recommended_base_size", "REAL");
  ensureColumn(db, "candidates", "risk_amount", "REAL");
  ensureColumn(db, "candidates", "account_risk_percent", "REAL");
  ensureColumn(db, "candidates", "same_direction_exposure_count", "INTEGER");
  ensureColumn(db, "candidates", "same_direction_exposure_risk_percent", "REAL");
  ensureColumn(db, "candidates", "projected_same_direction_risk_percent", "REAL");
  ensureColumn(db, "candidates", "portfolio_open_risk_percent", "REAL");
  ensureColumn(db, "candidates", "projected_portfolio_risk_percent", "REAL");
  ensureColumn(db, "candidate_snapshots", "base_candidate_id", "TEXT");
  ensureColumn(db, "candidate_snapshots", "recommended_position_size", "REAL");
  ensureColumn(db, "candidate_snapshots", "recommended_base_size", "REAL");
  ensureColumn(db, "candidate_snapshots", "risk_amount", "REAL");
  ensureColumn(db, "candidate_snapshots", "account_risk_percent", "REAL");
  ensureColumn(db, "candidate_snapshots", "same_direction_exposure_count", "INTEGER");
  ensureColumn(db, "candidate_snapshots", "same_direction_exposure_risk_percent", "REAL");
  ensureColumn(db, "candidate_snapshots", "projected_same_direction_risk_percent", "REAL");
  ensureColumn(db, "candidate_snapshots", "portfolio_open_risk_percent", "REAL");
  ensureColumn(db, "candidate_snapshots", "projected_portfolio_risk_percent", "REAL");
  ensureColumn(db, "candidate_snapshots", "liquidity_session", "TEXT");
  ensureColumn(db, "candidate_snapshots", "execution_outcome", "TEXT");
  ensureColumn(db, "candidate_snapshots", "execution_reason_code", "TEXT");
}

/**
 * 创建并初始化新的 `better-sqlite3` 数据库实例。
 * 测试时传入 `:memory:` 可直接使用内存数据库。
 */
export function openDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initDb(db);
  initPositionsDb(db);
  return db;
}

function ensureColumn(
  db: Database.Database,
  tableName: string,
  columnName: string,
  definition: string
): void {
  // 对历史数据库执行增量补字段，避免手工迁移。
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

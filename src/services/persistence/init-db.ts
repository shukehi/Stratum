import Database from "better-sqlite3";
import { logger } from "../../app/logger.js";
import { initPositionsDb } from "../positions/init-positions-db.js";

/**
 * 数据库初始化逻辑 (PHASE_08 - V2 Physics)
 */
export function initDb(db: Database.Database): void {
  logger.info("Initializing SQLite database (Zero-Entropy Schema)...");

  db.transaction(() => {
    // 1. K线数据表 (物理存储层)
    db.prepare(`
      CREATE TABLE IF NOT EXISTS candles (
        symbol    TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        open      REAL NOT NULL,
        high      REAL NOT NULL,
        low       REAL NOT NULL,
        close     REAL NOT NULL,
        volume    REAL NOT NULL,
        PRIMARY KEY (symbol, timeframe, timestamp)
      )
    `).run();

    // 2. 扫描日志表
    db.prepare(`
      CREATE TABLE IF NOT EXISTS scan_logs (
        id                     INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol                 TEXT    NOT NULL,
        scanned_at             INTEGER NOT NULL,
        candidates_found       INTEGER NOT NULL DEFAULT 0,
        alerts_sent            INTEGER NOT NULL DEFAULT 0,
        alerts_failed          INTEGER NOT NULL DEFAULT 0,
        alerts_skipped         INTEGER NOT NULL DEFAULT 0,
        errors_count           INTEGER NOT NULL DEFAULT 0,
        errors_json            TEXT    NOT NULL DEFAULT '[]',
        skip_stage             TEXT,
        skip_reason_code       TEXT,
        regime                 TEXT,
        participant_pressure_type TEXT,
        daily_bias             TEXT,
        order_flow_bias        TEXT,
        basis_divergence       INTEGER NOT NULL DEFAULT 0,
        market_driver_type     TEXT,
        liquidity_session      TEXT
      )
    `).run();

    // 3. 候选信号表
    db.prepare(`
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
        capital_velocity_score REAL NOT NULL,
        regime_aligned   INTEGER NOT NULL,
        participant_aligned INTEGER NOT NULL,
        structure_reason TEXT    NOT NULL,
        context_reason   TEXT    NOT NULL,
        reason_codes     TEXT    NOT NULL DEFAULT '[]',
        alert_status     TEXT    NOT NULL DEFAULT 'pending',
        created_at       INTEGER NOT NULL,
        updated_at       INTEGER NOT NULL,
        recommended_position_size REAL,
        recommended_base_size REAL,
        risk_amount      REAL,
        account_risk_percent REAL,
        same_direction_exposure_count INTEGER,
        same_direction_exposure_risk_percent REAL,
        projected_same_direction_risk_percent REAL,
        portfolio_open_risk_percent REAL,
        projected_portfolio_risk_percent REAL,
        delivery_started_at INTEGER,
        delivery_completed_at INTEGER,
        confirmation_status TEXT,
        daily_bias       TEXT,
        order_flow_bias  TEXT,
        regime           TEXT,
        regime_confidence REAL,
        market_driver_type TEXT,
        participant_bias  TEXT,
        participant_pressure_type TEXT,
        participant_confidence REAL,
        basis_divergence INTEGER NOT NULL DEFAULT 0,
        liquidity_session TEXT
      )
    `).run();

    // 4. 候选快照表
    db.prepare(`
      CREATE TABLE IF NOT EXISTS candidate_snapshots (
        id                     INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id           TEXT    NOT NULL,
        base_candidate_id      TEXT    NOT NULL,
        symbol                 TEXT    NOT NULL,
        direction              TEXT    NOT NULL,
        timeframe              TEXT    NOT NULL,
        entry_low              REAL    NOT NULL,
        entry_high             REAL    NOT NULL,
        stop_loss              REAL    NOT NULL,
        take_profit            REAL    NOT NULL,
        risk_reward            REAL    NOT NULL,
        capital_velocity_score REAL    NOT NULL,
        regime_aligned         INTEGER NOT NULL,
        participant_aligned    INTEGER NOT NULL,
        structure_reason       TEXT    NOT NULL,
        context_reason         TEXT    NOT NULL,
        reason_codes           TEXT    NOT NULL DEFAULT '[]',
        alert_status           TEXT    NOT NULL DEFAULT 'pending',
        confirmation_status    TEXT,
        recommended_position_size REAL,
        recommended_base_size     REAL,
        risk_amount               REAL,
        account_risk_percent      REAL,
        same_direction_exposure_count INTEGER,
        same_direction_exposure_risk_percent REAL,
        projected_same_direction_risk_percent REAL,
        portfolio_open_risk_percent REAL,
        projected_portfolio_risk_percent REAL,
        delivery_started_at    INTEGER,
        delivery_completed_at  INTEGER,
        daily_bias             TEXT,
        order_flow_bias        TEXT,
        regime                 TEXT,
        regime_confidence      REAL,
        market_driver_type     TEXT,
        participant_bias       TEXT,
        participant_pressure_type TEXT,
        participant_confidence REAL,
        basis_divergence       INTEGER NOT NULL DEFAULT 0,
        liquidity_session      TEXT,
        execution_outcome      TEXT,
        execution_reason_code  TEXT,
        created_at             INTEGER NOT NULL
      )
    `).run();

    db.prepare("CREATE INDEX IF NOT EXISTS idx_candidates_symbol ON candidates(symbol)").run();
    db.prepare("CREATE INDEX IF NOT EXISTS idx_candidate_snapshots_base ON candidate_snapshots(base_candidate_id)").run();
  })();
}

export function openDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initDb(db);
  initPositionsDb(db);
  return db;
}

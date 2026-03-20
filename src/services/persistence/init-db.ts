import Database from "better-sqlite3";
import { initPositionsDb } from "../positions/init-positions-db.js";

/**
 * DB 初期化  (PHASE_08)
 *
 * candidates テーブルを作成（存在しない場合のみ）。
 * id = symbol + direction + timeframe + entryHigh の組み合わせ（小数点以下切り捨て）。
 *
 * デタミニスティック主キー戦略:
 *   同一シグナルが複数回評価された場合に重複レコードを防ぐため、
 *   INSERT OR REPLACE で最新状態を上書きする。
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
  `);
}

/**
 * 新しい better-sqlite3 Database インスタンスを作成して初期化する。
 * テスト: path=":memory:" を渡すとインメモリ DB になる。
 */
export function openDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initDb(db);
  initPositionsDb(db);
  return db;
}

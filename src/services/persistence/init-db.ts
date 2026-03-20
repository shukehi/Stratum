import Database from "better-sqlite3";

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
  return db;
}

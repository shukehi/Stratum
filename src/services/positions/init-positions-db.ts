import Database from "better-sqlite3";

/**
 * positions テーブル初期化  (PHASE_10-B)
 *
 * id は candidates テーブルと同一フォーマット
 * （{symbol}_{direction}_{timeframe}_{floor(entryHigh)}）。
 * 同一シグナルが重複して open にならないよう PRIMARY KEY で制御。
 *
 * pnl_r / close_price / closed_at は平仓後に UPDATE で書き込む。
 */
export function initPositionsDb(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS positions (
      id             TEXT    PRIMARY KEY,
      symbol         TEXT    NOT NULL,
      direction      TEXT    NOT NULL,
      timeframe      TEXT    NOT NULL,
      entry_low      REAL    NOT NULL,
      entry_high     REAL    NOT NULL,
      stop_loss      REAL    NOT NULL,
      take_profit    REAL    NOT NULL,
      risk_reward    REAL    NOT NULL,
      signal_grade   TEXT    NOT NULL,
      status         TEXT    NOT NULL DEFAULT 'open',
      opened_at      INTEGER NOT NULL,
      closed_at      INTEGER,
      close_price    REAL,
      pnl_r          REAL
    );

    CREATE INDEX IF NOT EXISTS idx_positions_symbol
      ON positions(symbol);

    CREATE INDEX IF NOT EXISTS idx_positions_status
      ON positions(status);

    CREATE INDEX IF NOT EXISTS idx_positions_direction
      ON positions(direction, status);
  `);
}

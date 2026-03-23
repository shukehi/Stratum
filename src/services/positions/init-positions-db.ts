import Database from "better-sqlite3";

/**
 * 仓位数据库初始化 (PHASE_10-B - V2 Physics)
 */
export function initPositionsDb(db: Database.Database): void {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS positions (
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
      opened_at        INTEGER NOT NULL,
      status           TEXT    NOT NULL,
      notional_size    REAL,
      recommended_position_size REAL,
      recommended_base_size     REAL,
      risk_amount               REAL,
      account_risk_percent      REAL,
      closed_at        INTEGER,
      close_price      REAL,
      pnl_r            REAL,
      updated_at       INTEGER NOT NULL
    )
  `).run();

  db.prepare("CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_positions_symbol ON positions(symbol)").run();
}

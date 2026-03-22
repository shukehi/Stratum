import Database from "better-sqlite3";

/**
 * `positions` 表初始化  (PHASE_10-B)
 *
 * `id` 与 `candidates` 表保持同一确定性格式：
 *   `{symbol}_{direction}_{timeframe}_{entryHigh.toFixed(8)}`
 *
 * 这样同一信号重复进入时，不会写出多条同时处于 `open` 的仓位记录。
 * `pnl_r`、`close_price`、`closed_at` 会在平仓时通过 `UPDATE` 补写。
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
      recommended_position_size REAL,
      recommended_base_size REAL,
      risk_amount    REAL,
      account_risk_percent REAL,
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

  ensureColumn(db, "positions", "recommended_position_size", "REAL");
  ensureColumn(db, "positions", "recommended_base_size", "REAL");
  ensureColumn(db, "positions", "risk_amount", "REAL");
  ensureColumn(db, "positions", "account_risk_percent", "REAL");
}

// 允许的表名白名单，防止标识符注入
const ALLOWED_TABLES = new Set(["positions"]);

// 列名只允许小写字母、数字、下划线，且不以数字开头
const COLUMN_NAME_RE = /^[a-z_][a-z0-9_]*$/;

function ensureColumn(
  db: Database.Database,
  tableName: string,
  columnName: string,
  definition: string
): void {
  // 启动时做轻量级 schema 补齐，保证历史数据库也能平滑升级。
  if (!ALLOWED_TABLES.has(tableName)) {
    throw new Error(`ensureColumn: 非法表名 "${tableName}"`);
  }
  if (!COLUMN_NAME_RE.test(columnName)) {
    throw new Error(`ensureColumn: 非法列名 "${columnName}"`);
  }
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

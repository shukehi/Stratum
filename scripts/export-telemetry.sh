#!/usr/bin/env bash

# Stratum 2.0 物理数据导出引擎 (V2 Physics)
# 
# 物理准则：
#   数据导出必须是零损的、结构化的，且聚焦于物理动能指标。
#   主要导出：3-Sigma Index, CVS 分值, PnL 风险倍数。

set -euo pipefail

DB_FILE="./stratum.db"
EXPORT_DIR="./exports/telemetry_$(date +%Y%m%dT%H%M%S)"

if [[ ! -f "$DB_FILE" ]]; then
  echo "Error: stratum.db not found. Rocket hasn't collected any data yet."
  exit 1
fi

mkdir -p "$EXPORT_DIR"

echo "🚀 Starting Physics Telemetry Export..."

# 1. 导出物理感应日志 (Scan Logs - 动能感应)
echo "  [1/3] Exporting scan_logs (3-Sigma Sensor data)..."
sqlite3 -header -csv "$DB_FILE" "
SELECT 
  scanned_at, symbol, regime, participant_pressure_type, 
  daily_bias, order_flow_bias, liquidity_session, 
  candidates_found, alerts_sent, errors_count 
FROM scan_logs 
ORDER BY scanned_at DESC;" > "$EXPORT_DIR/scan_logs.csv"

# 2. 导出信号物理指纹 (Candidates - 期望值分布)
echo "  [2/3] Exporting candidates (CVS Expectation data)..."
sqlite3 -header -csv "$DB_FILE" "
SELECT 
  created_at, symbol, direction, timeframe, 
  capital_velocity_score, risk_reward, 
  regime_aligned, participant_aligned, 
  alert_status 
FROM candidates 
ORDER BY created_at DESC;" > "$EXPORT_DIR/candidates.csv"

# 3. 导出平仓表现 (Positions - 物理回报)
echo "  [3/3] Exporting positions (PnL & BE performance)..."
sqlite3 -header -csv "$DB_FILE" "
SELECT 
  opened_at, closed_at, symbol, direction, 
  capital_velocity_score, pnl_r, 
  be_activated, status 
FROM positions 
WHERE status != 'open'
ORDER BY opened_at DESC;" > "$EXPORT_DIR/positions.csv"

echo "✅ Telemetry Export Complete."
echo "Location: $EXPORT_DIR"
echo "物理建议：将这些 CSV 导入 Python/Excel 分析 3-Sigma 灵敏度与 CVS 置换效率。"

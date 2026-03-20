/**
 * CLI 格式化辅助函数
 * 纯函数，无外部依赖，使用 ANSI 转义码实现颜色
 */

// ── ANSI 颜色 ─────────────────────────────────────────────────────────────────

const C = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  green:  "\x1b[32m",
  red:    "\x1b[31m",
  yellow: "\x1b[33m",
  cyan:   "\x1b[36m",
  gray:   "\x1b[90m",
  white:  "\x1b[97m",
};

export const bold  = (s: string) => `${C.bold}${s}${C.reset}`;
export const dim   = (s: string) => `${C.dim}${s}${C.reset}`;
export const green = (s: string) => `${C.green}${s}${C.reset}`;
export const red   = (s: string) => `${C.red}${s}${C.reset}`;
export const yellow= (s: string) => `${C.yellow}${s}${C.reset}`;
export const cyan  = (s: string) => `${C.cyan}${s}${C.reset}`;
export const gray  = (s: string) => `${C.gray}${s}${C.reset}`;

// ── 布局辅助 ──────────────────────────────────────────────────────────────────

export const HR = gray("─".repeat(52));

export function header(title: string): void {
  console.log();
  console.log(bold(cyan(title)));
  console.log(HR);
}

export function kv(label: string, value: string, width = 24): void {
  console.log(`  ${label.padEnd(width)}${value}`);
}

export function section(title: string): void {
  console.log();
  console.log(bold(title));
}

// ── 数值格式化 ────────────────────────────────────────────────────────────────

export function fmtR(r: number): string {
  const sign = r >= 0 ? "+" : "";
  const str  = `${sign}${r.toFixed(2)}R`;
  return r >= 0 ? green(str) : red(str);
}

export function fmtPct(rate: number): string {
  const str = `${(rate * 100).toFixed(1)}%`;
  return rate >= 0.5 ? green(str) : rate >= 0.35 ? yellow(str) : red(str);
}

export function fmtPrice(p: number): string {
  return p.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function fmtTime(ms: number): string {
  const d = new Date(ms);
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return `${date} ${time} UTC`;
}

function pad(n: number): string { return String(n).padStart(2, "0"); }

// ── 简易 ASCII 表格 ───────────────────────────────────────────────────────────

export type TableRow = Record<string, string>;

export function printTable(cols: string[], rows: TableRow[]): void {
  // 计算每列最大宽度（忽略 ANSI 转义码）
  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
  const widths = cols.map((c) =>
    Math.max(c.length, ...rows.map((r) => stripAnsi(r[c] ?? "").length))
  );

  const pad2 = (s: string, w: number) => {
    const visible = stripAnsi(s).length;
    return s + " ".repeat(Math.max(0, w - visible));
  };

  // 表头
  const hdr = cols.map((c, i) => bold(c.padEnd(widths[i]))).join("  ");
  console.log(`  ${hdr}`);
  console.log(`  ${gray(widths.map((w) => "─".repeat(w)).join("  "))}`);

  // 数据行
  for (const row of rows) {
    const line = cols.map((c, i) => pad2(row[c] ?? "", widths[i])).join("  ");
    console.log(`  ${line}`);
  }
}

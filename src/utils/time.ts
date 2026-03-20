export function nowMs(): number {
  return Date.now();
}

export function hoursAgoMs(hours: number): number {
  return Date.now() - hours * 60 * 60 * 1000;
}

export function msToISOString(ms: number): string {
  return new Date(ms).toISOString();
}

export function getNextRunAt(nowMs: number, delaySec: number): string {
  return new Date(nowMs + Math.max(0, delaySec) * 1000).toISOString();
}

export function getRemainingDelaySec(nextRunAt: string | undefined, nowMs: number): number | null {
  if (!nextRunAt) {
    return null;
  }

  const targetMs = Date.parse(nextRunAt);
  if (Number.isNaN(targetMs)) {
    return null;
  }

  return Math.max(0, Math.ceil((targetMs - nowMs) / 1000));
}

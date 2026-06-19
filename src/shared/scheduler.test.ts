import { describe, expect, it } from 'vitest';
import { getNextRunAt, getRemainingDelaySec } from './scheduler';

describe('scheduler helpers', () => {
  it('creates an ISO next-run timestamp from the requested delay', () => {
    const nowMs = Date.parse('2026-06-19T11:00:00.000Z');

    expect(getNextRunAt(nowMs, 75)).toBe('2026-06-19T11:01:15.000Z');
  });

  it('rounds remaining seconds up so the popup countdown does not reach zero early', () => {
    const nowMs = Date.parse('2026-06-19T11:00:00.250Z');
    const nextRunAt = '2026-06-19T11:01:00.000Z';

    expect(getRemainingDelaySec(nextRunAt, nowMs)).toBe(60);
  });

  it('never returns a negative remaining delay', () => {
    const nowMs = Date.parse('2026-06-19T11:02:00.000Z');

    expect(getRemainingDelaySec('2026-06-19T11:01:00.000Z', nowMs)).toBe(0);
  });
});

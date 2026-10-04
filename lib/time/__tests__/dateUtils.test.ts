import { describe, expect, it } from 'vitest';
import { getLocalMonthKey, parseLocalDate } from '../dateUtils';

describe('dateUtils', () => {
  it('parses ISO timestamps as local calendar dates without timezone drift', () => {
    const parsed = parseLocalDate('2026-03-01T00:00:00.000Z');
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(2);
    expect(parsed.getDate()).toBe(1);
  });

  it('returns month keys based on local calendar parsing', () => {
    expect(getLocalMonthKey('2026-03-31T23:59:59.000Z')).toBe('2026-03');
  });
});

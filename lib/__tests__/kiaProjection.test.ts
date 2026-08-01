import { describe, it, expect } from 'vitest';
import { generateProjectedTransactions } from '../projectedTransactions';
import type { Transaction } from '../../types';

/**
 * Biweekly projection from a recurring anchor.
 *
 * These dates are derived from "today", not hardcoded. The previous version
 * pinned the anchor to 2026-07-03 and asserted occurrences on 7/17 and 7/31;
 * those are only *future* occurrences until the calendar passes them, so the
 * suite began failing on 2026-08-01 with no code change behind it. A test that
 * expires on a particular morning is worse than no test — it blocks CI, and
 * therefore the APK build, for a reason unrelated to the change in front of it.
 */

/** Local-date YYYY-MM-DD, matching toIsoDay() in projectedTransactions.ts. */
function isoDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysFromToday(offset: number): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
}

const ANCHOR_OFFSET_DAYS = -28;
const anchorDate = daysFromToday(ANCHOR_OFFSET_DAYS);

const tx = (overrides: Partial<Transaction>): Transaction => ({
  id: 'kia-anchor',
  user_id: 'u',
  vendor: 'Kia',
  amount: 458.69,
  date: isoDay(anchorDate),
  budget_id: 'transport',
  recurrence: 'Biweekly',
  label: 'Manual',
  is_projected: false,
  created_at: anchorDate.toISOString(),
  source: 'manual',
  ...overrides,
} as Transaction);

describe('Biweekly projection from a recurring anchor', () => {
  it('generates occurrences every 14 days', () => {
    const projected = generateProjectedTransactions([tx({})]);
    const dates = projected.map((p) => p.date).sort();

    expect(dates.length).toBeGreaterThan(1);

    // Every occurrence sits on the anchor's 14-day cadence.
    for (const date of dates) {
      const deltaDays = Math.round(
        (new Date(`${date}T12:00:00`).getTime() - anchorDate.getTime()) / 86_400_000,
      );
      expect(deltaDays % 14, `${date} is not on the 14-day cadence`).toBe(0);
    }

    // Consecutive occurrences are exactly 14 days apart — no gaps, no doubles.
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(`${dates[i - 1]}T12:00:00`).getTime();
      const curr = new Date(`${dates[i]}T12:00:00`).getTime();
      expect(Math.round((curr - prev) / 86_400_000)).toBe(14);
    }
  });

  it('does not re-emit the anchor itself', () => {
    const projected = generateProjectedTransactions([tx({})]);
    const dates = projected.map((p) => p.date);
    expect(dates).not.toContain(isoDay(anchorDate));
  });

  it('marks future occurrences as projected', () => {
    const projected = generateProjectedTransactions([tx({})]);
    const today = isoDay(new Date());

    const future = projected.filter((p) => p.date > today);
    expect(future.length).toBeGreaterThan(0);
    for (const occurrence of future) {
      expect(occurrence.is_projected, `${occurrence.date} should be projected`).toBe(true);
    }
  });
});

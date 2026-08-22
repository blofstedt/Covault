import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Recurring charges are display-only.
 *
 * `generateProjectedTransactions` already puts the current month's occurrences
 * into the dashboard total — one whose date has passed is emitted with
 * `is_projected: false`, so it counts exactly like a real row. A second system
 * that also inserted a real row per due date therefore counted every
 * subscription twice, and its rows (label 'Automatic') queued up in Review for
 * the user to delete by hand every day. Deleting them put them back in scope
 * for the next run, so they came back every morning.
 *
 * This test fails if that catch-up is ever reintroduced.
 */

const root = resolve(__dirname, '../..');

describe('recurring charges', () => {
  it('has no DB-writing recurring executor module', () => {
    expect(existsSync(resolve(root, 'lib/recurringExecutor.ts'))).toBe(false);
  });

  it('is not auto-inserted from App.tsx', () => {
    const app = readFileSync(resolve(root, 'App.tsx'), 'utf8');
    expect(app).not.toMatch(/executeRecurringTransactions/);
    expect(app).not.toMatch(/sendRecurringCatchUpNotification/);
  });

  it('has no module posting rows marked as executor-spawned', () => {
    const notifications = readFileSync(resolve(root, 'lib/appNotifications.ts'), 'utf8');
    expect(notifications).not.toMatch(/Recurring transactions caught up/);
  });
});

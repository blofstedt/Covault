import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * What the recurring executor actually puts on the wire.
 *
 * Every one of these pins a shape the database rejects rather than a
 * preference. The executor spent its whole life posting a category UUID into
 * an enum column that only accepts the seven category names, so Postgres threw
 * out every batch and no recurring charge was ever filled in — silently, and
 * five or six times per app launch, because the once-a-day marker is only
 * written after a successful insert.
 */

const storage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
  };
})();
vi.stubGlobal('localStorage', storage);

const calls: Array<{ url: string; init?: any }> = [];
let insertOk = true;

vi.mock('../apiHelpers', () => ({
  restFetch: async (url: string, init?: any) => {
    calls.push({ url, init });
    if (init?.method === 'POST') {
      return insertOk
        ? { ok: true, status: 201, text: async () => '[]' }
        : { ok: false, status: 400, text: async () => '{"message":"invalid input value for enum"}' };
    }
    return { ok: true, status: 200, json: async () => [], text: async () => '[]' };
  },
}));

import { executeRecurringTransactions, budgetIdToName, _resetFailureCountForTesting } from '../recurringExecutor';
import { SYSTEM_CATEGORIES } from '../../constants';
import { Recurrence } from '../../types';
import type { Transaction } from '../../types';

const LEISURE = SYSTEM_CATEGORIES.find((c) => c.name === 'Leisure')!;

/** A monthly template dated a month and a bit ago, so one instance is due. */
const template = (overrides: Partial<Transaction> = {}): Transaction => {
  const base = new Date();
  base.setMonth(base.getMonth() - 1);
  base.setDate(2);
  const iso = base.toISOString().slice(0, 10);
  return {
    id: 'tpl-1',
    user_id: 'u1',
    vendor: 'Netflix',
    amount: 27.11,
    date: `${iso}T12:00:00.000Z`,
    budget_id: LEISURE.id,
    recurrence: Recurrence.MONTHLY,
    label: 'Manual',
    is_projected: false,
    created_at: `${iso}T12:00:00.000Z`,
    ...overrides,
  };
};

const insertBody = () => {
  const post = calls.find((c) => c.init?.method === 'POST');
  return post ? JSON.parse(post.init.body) : null;
};

describe('recurring executor writes', () => {
  beforeEach(() => {
    calls.length = 0;
    insertOk = true;
    storage.clear();
    _resetFailureCountForTesting();
  });

  it('sends the category name the budget column accepts, not its id', async () => {
    await executeRecurringTransactions('u1', [template()], { force: true });
    const rows = insertBody();
    expect(rows).not.toBeNull();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.budget).toBe('Leisure');
  });

  it('leaves out a template whose category has no name, rather than losing the batch', async () => {
    await executeRecurringTransactions(
      'u1',
      [
        template(),
        template({ id: 'tpl-2', vendor: 'Mystery', budget_id: 'budget:not-a-category' }),
      ],
      { force: true },
    );
    const rows = insertBody();
    expect(rows.map((r: any) => r.vendor)).toEqual(['Netflix']);
  });

  it('looks for existing charges by date range — a date column cannot be pattern-matched', async () => {
    await executeRecurringTransactions('u1', [template()], { force: true });
    const lookups = calls.filter((c) => c.url.includes('select=vendor,amount,date'));
    expect(lookups.length).toBeGreaterThan(0);
    for (const call of lookups) {
      expect(call.url).not.toContain('like.');
      expect(call.url).toMatch(/date=gte\.\d{4}-\d{2}-01&date=lt\.\d{4}-\d{2}-01/);
    }
  });

  it('stops retrying after a few failures instead of re-posting on every reload', async () => {
    insertOk = false;
    for (let i = 0; i < 6; i++) {
      await executeRecurringTransactions('u1', [template()], { force: true });
    }
    expect(calls.filter((c) => c.init?.method === 'POST')).toHaveLength(3);
  });
});

describe('budgetIdToName', () => {
  it('maps a system category id to its name', () => {
    expect(budgetIdToName(LEISURE.id)).toBe('Leisure');
  });

  it('maps the prefixed form and a plain name', () => {
    expect(budgetIdToName('budget:groceries')).toBe('Groceries');
    expect(budgetIdToName('Transport')).toBe('Transport');
  });

  it('files an absent category under Other, the way the rest of the app does', () => {
    expect(budgetIdToName(null)).toBe('Other');
  });

  it('refuses a name the column has no room for', () => {
    expect(budgetIdToName('budget:holiday-fund')).toBeNull();
    expect(budgetIdToName('11111111-2222-3333-4444-555555555555')).toBeNull();
  });
});

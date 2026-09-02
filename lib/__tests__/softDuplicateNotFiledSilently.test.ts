import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A charge that looks like one already on the books is never filed unseen.
 *
 * The pipeline deliberately does not skip a "soft" duplicate — a second report
 * of the same merchant a day or two later might be a second real purchase, and
 * the user would rather delete a row than lose a charge. That bargain only
 * holds if they actually SEE the second row.
 *
 * With "file known vendors automatically" on, they did not. A monthly
 * insurance premium reported by the bank on two consecutive days, a rounding
 * cent apart, matched the user's own rule both times: the second report went
 * straight to the dashboard already cleared, appearing in no review list, and
 * the month was over by $477. Auto-filing is now refused for a capture that
 * looks like a duplicate — the row is still written, it just has to be looked
 * at.
 */

vi.mock('../aiExtractor', () => ({
  extractWithAI: async () => {
    throw new Error('the AI is not consulted for a confidently parsed alert');
  },
  aiFindRefundMatch: async () => null,
}));

vi.mock('../apiHelpers', () => ({
  restFetch: async () => ({ ok: true, status: 200, json: async () => [], text: async () => '[]' }),
  REST_BASE: 'https://example.test/rest/v1',
  getAuthHeaders: async () => ({}),
}));

const inserts: Record<string, unknown[]> = {};
const tableResults: Record<string, { data: unknown[]; error: unknown }> = {};

function tableChain(table: string) {
  const chain: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') {
          return (resolvefn: (value: unknown) => unknown) =>
            resolvefn(tableResults[table] ?? { data: [], error: null });
        }
        if (prop === 'insert') {
          return (row: unknown) => {
            (inserts[table] ||= []).push(row);
            return chain;
          };
        }
        return () => chain;
      },
    },
  );
  return chain;
}

vi.mock('../supabase', () => ({
  supabase: { from: (table: string) => tableChain(table) },
  supabaseUrl: 'https://example.test',
  supabaseAnonKey: 'anon',
}));

import { processNotificationWithAI, _clearDedupCacheForTesting } from '../notificationProcessor';
import { getLocalToday } from '../dateUtils';

const CATEGORIES = [
  { id: 'cat-transport', name: 'Transport' },
  { id: 'cat-other', name: 'Other' },
];

const ALERT = 'INTACT INSURANCE 🚗 You spent $477.46 with your credit card.';

/** Yesterday, in the same local calendar the pipeline files captures under. */
function yesterday(): string {
  const today = getLocalToday();
  const [y, m, d] = today.split('-').map(Number);
  const date = new Date(y, m - 1, d - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

beforeEach(() => {
  for (const key of Object.keys(inserts)) delete inserts[key];
  for (const key of Object.keys(tableResults)) delete tableResults[key];
  _clearDedupCacheForTesting();
});

/** A rule matched on the whole name — the strongest case auto-accept can get. */
function teachRule() {
  tableResults.overrides = {
    data: [
      {
        category_id: 'Transport',
        proper_name: 'Intact Insurance',
        match_key: '',
        match_type: 'exact',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ],
    error: null,
  };
}

/** Yesterday's report of the same premium, a cent lighter, not marked recurring. */
function alreadyOnTheBooks() {
  tableResults.transactions = {
    data: [
      {
        id: 'intact-yesterday',
        vendor: 'Intact Insurance',
        amount: 477.45,
        type: 'Automatic',
        date: yesterday(),
        recur: 'One-time',
        source: 'notification',
        created_at: `${yesterday()}T12:00:00.000Z`,
      },
    ],
    error: null,
  };
}

async function capture(overrides: Record<string, unknown> = {}) {
  return processNotificationWithAI(
    'user-1',
    {
      rawNotification: ALERT,
      bankAppId: 'com.bmo.mobile',
      bankName: 'BMO',
      notificationTimestamp: Date.now(),
      ...overrides,
    },
    CATEGORIES,
  );
}

describe('a capture that looks like a charge already on the books', () => {
  it('goes to review instead of being filed on arrival', async () => {
    teachRule();
    alreadyOnTheBooks();

    const result = await capture({ autoAcceptKnownVendors: true });

    // Still captured — a possible duplicate is never dropped.
    expect(result.transactionId).toBeTruthy();
    expect(result.autoAccepted).toBe(false);

    const row = inserts.transactions?.[0] as Record<string, unknown>;
    expect(row).toBeTruthy();
    // Neither marked filed nor cleared, so the review list shows it.
    expect(row).not.toHaveProperty('auto_filed');
    expect(row).not.toHaveProperty('caught_cleared');
    // And the UI is told what it resembles.
    expect(result.softDuplicateOf?.id).toBe('intact-yesterday');
  });

  it('still files an ordinary capture on arrival when nothing resembles it', async () => {
    teachRule();

    const result = await capture({ autoAcceptKnownVendors: true });

    expect(result.autoAccepted).toBe(true);
    const row = inserts.transactions?.[0] as Record<string, unknown>;
    expect(row.auto_filed).toBe(true);
  });
});

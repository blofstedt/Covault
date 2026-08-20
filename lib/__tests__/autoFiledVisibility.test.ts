import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A purchase the app files for you is still a purchase you have seen.
 *
 * With "file known vendors automatically" on, a capture matching a learned
 * rule is stored already cleared, so it never enters the review list. That is
 * the point of the setting — but nothing recorded that it had happened, and
 * nothing anywhere showed it. The capture page said "All caught up" while
 * purchases were being recorded: 197 captures filed, none ever listed. Twice
 * the same purchase was typed in by hand within a minute of being captured,
 * because there was nowhere its capture could be seen.
 *
 * Two halves hold the fix together, and either one alone restores the silence:
 *   - the insert marks the row `auto_filed`, the only thing that later tells a
 *     row the user never saw from one they reviewed and filed themselves;
 *   - selectRecentlyAutoFiled lists exactly those rows, so the card has
 *     something to show.
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

// Same minimal Supabase stand-in as the other pipeline tests: every builder
// method returns the chain, and awaiting it yields the canned rows.
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
import { selectRecentlyAutoFiled, AUTO_FILED_WINDOW_DAYS } from '../reviewQueue';
import type { Transaction } from '../../types';

const CATEGORIES = [
  { id: 'cat-groceries', name: 'Groceries' },
  { id: 'cat-other', name: 'Other' },
];

// The shape the user's own bank sends, which the regex parser reads
// confidently — so nothing here depends on the on-device model.
const ALERT = 'BLUE DOOR CAFE 🍴 You spent $12.40 with your credit card.';

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
        category_id: 'Groceries',
        proper_name: 'Blue Door Cafe',
        match_key: '',
        match_type: 'exact',
        updated_at: '2026-01-01T00:00:00Z',
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

describe('a capture filed on arrival', () => {
  it('is marked as filed by the app, not by the user', async () => {
    teachRule();

    const result = await capture({ autoAcceptKnownVendors: true });

    expect(result.autoAccepted).toBe(true);
    const row = inserts.transactions?.[0] as Record<string, unknown>;
    // Both, together: cleared is what hides it from review, auto_filed is what
    // lets it be shown anywhere else. Cleared without the mark is the silence.
    expect(row.caught_cleared).toBe(true);
    expect(row.auto_filed).toBe(true);
  });

  it('leaves an ordinary capture unmarked, so the card only shows what it should', async () => {
    teachRule();

    await capture();

    const row = inserts.transactions?.[0] as Record<string, unknown>;
    expect(row).not.toHaveProperty('auto_filed');
    expect(row).not.toHaveProperty('caught_cleared');
  });
});

function tx(over: Partial<Transaction>): Transaction {
  return {
    id: Math.random().toString(36).slice(2),
    user_id: 'user-1',
    vendor: 'Blue Door Cafe',
    amount: 12.4,
    date: '2026-08-20',
    budget_id: 'cat-groceries',
    is_projected: false,
    label: 'Automatic',
    auto_filed: true,
    caught_cleared: true,
    created_at: '2026-08-20T00:00:00Z',
    ...over,
  };
}

describe('the list of what was filed automatically', () => {
  const TODAY = '2026-08-20';

  it('shows a capture the user was never given the chance to see', () => {
    expect(selectRecentlyAutoFiled([tx({})], TODAY)).toHaveLength(1);
  });

  it('leaves out rows the user filed themselves', () => {
    // Same shape in every other respect — this is the distinction the whole
    // feature rests on, and without the column it cannot be made at all.
    expect(selectRecentlyAutoFiled([tx({ auto_filed: false })], TODAY)).toHaveLength(0);
  });

  it('leaves out manual entries', () => {
    expect(
      selectRecentlyAutoFiled([tx({ label: 'Manual' })], TODAY),
    ).toHaveLength(0);
  });

  it('forgets one that has stopped being news', () => {
    const inside = tx({ date: '2026-08-14' });
    const outside = tx({ date: '2026-08-12' });

    const listed = selectRecentlyAutoFiled([inside, outside], TODAY);

    expect(listed.map((row) => row.date)).toEqual(['2026-08-14']);
    expect(AUTO_FILED_WINDOW_DAYS).toBe(7);
  });

  it('reads a date carrying a timestamp, which is how the app holds them', () => {
    // fromSupabaseTransaction appends noon UTC to every date, so a selector
    // comparing the raw string would drop every row it is meant to show.
    expect(
      selectRecentlyAutoFiled([tx({ date: '2026-08-19T12:00:00.000Z' })], TODAY),
    ).toHaveLength(1);
  });

  it('puts the newest first', () => {
    const listed = selectRecentlyAutoFiled(
      [tx({ date: '2026-08-16' }), tx({ date: '2026-08-19' }), tx({ date: '2026-08-17' })],
      TODAY,
    );

    expect(listed.map((row) => row.date)).toEqual(['2026-08-19', '2026-08-17', '2026-08-16']);
  });

  it('crosses a month boundary rather than losing the week behind it', () => {
    // Written as strings all the way through, so the window has to be built
    // from date parts — subtracting days from "2026-09-02" naively gives
    // "2026-09--5" and silently matches nothing.
    const listed = selectRecentlyAutoFiled(
      [tx({ date: '2026-08-30' }), tx({ date: '2026-08-24' })],
      '2026-09-02',
    );

    expect(listed.map((row) => row.date)).toEqual(['2026-08-30']);
  });
});

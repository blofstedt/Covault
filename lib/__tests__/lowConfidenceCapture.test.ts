import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * A purchase the on-device model was unsure about must still reach Review.
 *
 * It used to be destroyed. The pipeline had a "confidence gate": when the AI
 * put its confidence below 0.75 the capture was diverted into a
 * `pending_transactions` row instead of the ledger — and that table does not
 * exist in this database. supabase-js reports a failed insert in a returned
 * value rather than by throwing, nothing read it, and the diversion had
 * already called markNotificationProcessed, which is permanent. So the row was
 * never written, the notification could never be reprocessed, and the only
 * trace was the "$X at Y — captured" the phone had already shown. The user
 * opened Review and found nothing there.
 *
 * The rule now is simply: an uncertain extraction is what Review is FOR. It
 * goes in like any other capture, carrying its confidence so the card can show
 * a meter, and the one thing it may never do is get auto-filed.
 */

// ── The on-device model, forced to be unsure ──
const mockExtractWithAI = vi.fn();
vi.mock('../aiExtractor', () => ({
  extractWithAI: (...args: unknown[]) => mockExtractWithAI(...args),
  aiFindRefundMatch: async () => null,
}));

vi.mock('../apiHelpers', () => ({
  restFetch: async () => ({ ok: true, status: 200, json: async () => [], text: async () => '[]' }),
  REST_BASE: 'https://example.test/rest/v1',
  getAuthHeaders: async () => ({}),
}));

// ── Supabase ──
// Every builder method returns the same object and awaiting it yields the
// canned result for that table, which is all this pipeline asks of it.
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

const CATEGORIES = [
  { id: 'cat-groceries', name: 'Groceries' },
  { id: 'cat-other', name: 'Other' },
];

/**
 * Confidence 0.5 from the regex parser — below AI_FALLBACK_CONFIDENCE_THRESHOLD
 * — so the on-device model is consulted and its verdict is the one that counts.
 */
const UNSURE_NOTIFICATION = 'BMO: $100.00 pending, $250.00 available';

beforeEach(() => {
  for (const key of Object.keys(inserts)) delete inserts[key];
  for (const key of Object.keys(tableResults)) delete tableResults[key];
  _clearDedupCacheForTesting();
  mockExtractWithAI.mockReset();
  mockExtractWithAI.mockResolvedValue({
    isTransaction: true,
    vendor: 'Blue Door Cafe',
    amount: 100,
    suggestedCategory: 'Groceries',
    confidence: 0.4,
    confidenceLabel: 'low',
  });
});

/**
 * A rule the user taught, matched on the whole name — which scores 1 by
 * construction and is the strongest case auto-accept can be handed.
 */
function teachRuleForBlueDoorCafe() {
  tableResults.overrides = {
    data: [
      {
        // The overrides table stores the budget NAME in category_id.
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
      rawNotification: UNSURE_NOTIFICATION,
      bankAppId: 'com.bmo.mobile',
      bankName: 'BMO',
      notificationTimestamp: Date.now(),
      ...overrides,
    },
    CATEGORIES,
  );
}

describe('a capture the model was unsure about', () => {
  it('lands in the ledger instead of disappearing', async () => {
    const result = await capture();

    expect(result.isTransaction).toBe(true);
    expect(result.transactionId).toBeTruthy();
    expect(inserts.transactions).toHaveLength(1);
  });

  it('is left for the user to look at, never filed on arrival', async () => {
    // A learned rule that explains the name perfectly — which on its own is
    // enough for auto-accept to file the row without ever showing it.
    teachRuleForBlueDoorCafe();

    const result = await capture({ autoAcceptKnownVendors: true });

    expect(result.autoAccepted).toBe(false);
    // caught_cleared is what takes a row OUT of the review list, so an
    // uncertain capture must not carry it.
    expect(inserts.transactions?.[0]).not.toHaveProperty('caught_cleared');
  });

  it('but the same rule still files a capture the model was sure about', async () => {
    // The control. Auto-accept is a feature the user turned on, and low
    // confidence is meant to be the only thing holding it back here — if this
    // one stops passing, the guard above has quietly switched auto-accept off.
    teachRuleForBlueDoorCafe();
    mockExtractWithAI.mockResolvedValue({
      isTransaction: true,
      vendor: 'Blue Door Cafe',
      amount: 100,
      suggestedCategory: 'Groceries',
      confidence: 0.95,
      confidenceLabel: 'high',
    });

    const result = await capture({ autoAcceptKnownVendors: true });

    expect(result.autoAccepted).toBe(true);
  });

  it('records how unsure it was, so the review card can show it', async () => {
    await capture();

    expect((inserts.transactions?.[0] as Record<string, unknown>).confidence).toBe(0.4);
  });

  it('never writes to pending_transactions', async () => {
    await capture();

    expect(inserts.pending_transactions).toBeUndefined();
  });
});

/**
 * The table the old gate wrote to has never existed in this database (see
 * CLAUDE.md). Anything that starts writing to it again fails silently, so the
 * absence is worth holding in place rather than trusting to memory.
 */
describe('the pipeline source', () => {
  it('does not insert into pending_transactions anywhere', () => {
    const source = readFileSync(
      resolve(__dirname, '../notificationProcessor.ts'),
      'utf-8',
    );
    expect(source).not.toMatch(/from\(['"]pending_transactions['"]\)\s*\n?\s*\.insert/);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A purchase captured while the app was closed took a few seconds to appear
 * after opening it, and nothing in the app was slow. The pipeline simply asked
 * the database one question at a time: is this alert one the user has told us
 * to ignore, then is it a duplicate, then what else did they spend near this
 * date, then what are their vendor rules, then what recurring charges do they
 * have. Six or seven round trips, each one waiting for the last, on a phone
 * that has just woken its radio — that queue *was* the wait.
 *
 * None of those reads needs another one's answer, so they are now issued in
 * two waves: the checks that can reject the alert outright, and then the
 * lookups the rest of the work needs. The decisions and the order they are
 * made in are untouched; only the waiting is.
 *
 * This holds that shape in place. It counts how many reads are in flight at
 * once during one ordinary capture: if a later change puts an `await` between
 * two reads that do not depend on each other, the concurrency drops and this
 * fails rather than the app quietly going back to feeling slow.
 *
 * What it cannot measure is the phone. Nothing in CI has a radio to wake.
 */

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
  registerPlugin: vi.fn(),
}));

// The AI fallback is never reached for the well-formed alert below, but the
// module is imported either way and its pinning of the ONNX runtime path needs
// this shape to exist.
vi.mock('@huggingface/transformers', () => ({
  env: { version: '0.0.0-test', backends: { onnx: { wasm: { wasmPaths: '' } } } },
  pipeline: async () => async () => [{ generated_text: '' }],
}));

vi.mock('../apiHelpers', () => ({
  REST_BASE: 'https://mock.supabase.co/rest/v1',
  getAuthHeaders: vi.fn().mockResolvedValue({}),
  // No skip rules: this capture is an ordinary purchase.
  restFetch: vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => [],
    text: async () => '[]',
  }),
}));

/** Reads currently in flight, and the high-water mark across the capture. */
let inFlight = 0;
let maxInFlight = 0;
/** Every table read, in the order the reads were issued. */
let readOrder: string[] = [];

/**
 * A stand-in for a query builder that behaves like the real one in the way
 * that matters here: it is thenable, and it answers on a later tick rather
 * than immediately, so two reads issued together really do overlap.
 */
function chainFor(table: string) {
  const chain: any = {};
  for (const method of [
    'select', 'eq', 'gte', 'lte', 'ilike', 'in', 'is', 'order', 'limit',
    'neq', 'gt', 'lt', 'not', 'insert', 'update', 'delete', 'upsert',
  ]) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  chain.single = vi.fn().mockReturnValue(chain);
  chain.then = (onFulfilled: (value: { data: unknown[]; error: null }) => unknown) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    readOrder.push(table);
    return new Promise((resolve) => {
      setTimeout(() => {
        inFlight -= 1;
        resolve(onFulfilled({ data: [], error: null }));
      }, 2);
    });
  };
  return chain;
}

vi.mock('../supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => chainFor(table)),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
  },
  supabaseUrl: 'https://mock.supabase.co',
  supabaseAnonKey: 'mock-anon-key',
}));

import {
  processNotificationWithAI,
  _clearDedupCacheForTesting,
  _clearRecurringCacheForTesting,
} from '../notificationProcessor';
import { invalidateNotificationRulesCache } from '../notificationRules';

const CATEGORIES = [
  { id: 'cat-groceries', name: 'Groceries' },
  { id: 'cat-other', name: 'Other' },
];

beforeEach(() => {
  inFlight = 0;
  maxInFlight = 0;
  readOrder = [];
  _clearDedupCacheForTesting();
  _clearRecurringCacheForTesting();
  invalidateNotificationRulesCache();
});

async function captureOnePurchase() {
  return processNotificationWithAI(
    'user-1',
    {
      rawNotification: 'LOBLAWS #1042 You spent $84.21 with your credit card.',
      bankAppId: 'com.bmo.mobile',
      bankName: 'BMO',
      notificationTimestamp: Date.now(),
      // The native listener always sends what its own regex read, and the
      // duplicate check needs both to have anything to compare against.
      fallbackVendor: 'LOBLAWS',
      fallbackAmount: 84.21,
    },
    CATEGORIES,
  );
}

describe('how long a capture waits on the database', () => {
  it('captures the purchase', async () => {
    // Guards everything below: a capture that bailed out early would ask for
    // almost nothing and pass the concurrency assertions vacuously.
    const result = await captureOnePurchase();
    expect(result.processed).toBe(true);
    expect(result.isTransaction).toBe(true);
    expect(result.amount).toBeCloseTo(84.21, 2);
  });

  it('asks several questions at once rather than one after another', async () => {
    await captureOnePurchase();
    // Three reads overlap at the widest point: the nearby transactions, the
    // vendor rules and the recurring charges, none of which needs another's
    // answer. Two of them running one after the other is a round trip of
    // waiting the user can feel.
    expect(maxInFlight).toBeGreaterThanOrEqual(3);
  });

  it('starts the duplicate check without waiting for the skip-rule check', async () => {
    await captureOnePurchase();
    // The first two reads are the duplicate check's pair — the ledger and the
    // pending queue — and they are issued together, before either answers.
    expect(readOrder.slice(0, 2).sort()).toEqual(['pending_transactions', 'transactions']);
  });

  it('still reads every table the decisions are made from', async () => {
    await captureOnePurchase();
    // Overlapping the reads must not quietly drop one. Each of these answers a
    // different question: is it a duplicate, is it near something else, does a
    // vendor rule apply, is it already a recurring charge.
    expect(readOrder).toContain('transactions');
    expect(readOrder).toContain('pending_transactions');
    expect(readOrder).toContain('overrides');
    // Four reads of `transactions` and one of each other table on this path;
    // the point is that none of them went missing, not the exact count.
    expect(readOrder.filter((t) => t === 'transactions').length).toBeGreaterThanOrEqual(3);
  });
});

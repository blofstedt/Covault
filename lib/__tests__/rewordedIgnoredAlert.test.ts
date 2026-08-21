import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The second half of "ignore alerts like this one".
 *
 * Comparing shapes catches the same alert with a different number in it. What
 * it cannot catch is the same alert REWORDED — a bank changing its phrasing
 * from "You spent $45.00" to "charged $45.00 to your credit card". To the
 * comparison those are two different notifications; to the person holding the
 * phone it is plainly the thing they already said they did not want.
 *
 * So the model gets a second look. The rules that keep it from being dangerous
 * are the ones worth pinning:
 *
 *   - it is only ever asked about alerts that already share most of their
 *     wording with something the user ignored, so an ordinary purchase never
 *     costs an inference and can never be silenced by it;
 *   - a reply that is not "yes" is a no, and so is a model that will not load;
 *   - a yes is recorded as a GUESS, not as a rule, so the scan button can
 *     overrule it and the capture is recoverable.
 */

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
  registerPlugin: vi.fn(),
}));

const { mockLooksLikeIgnored } = vi.hoisted(() => ({
  mockLooksLikeIgnored: vi.fn(),
}));

vi.mock('../aiExtractor', () => ({
  aiLooksLikeIgnoredAlert: mockLooksLikeIgnored,
  aiFindRefundMatch: vi.fn().mockResolvedValue(null),
  extractWithAI: vi.fn().mockRejectedValue(new Error('no model in tests')),
}));

/** One rule: a gym charge the user has told Covault to leave alone. */
const IGNORED = 'ACME GYM MEMBERSHIP You spent $45.00 with your credit card.';

vi.mock('../apiHelpers', () => ({
  REST_BASE: 'https://mock.supabase.co/rest/v1',
  getAuthHeaders: vi.fn().mockResolvedValue({}),
  restFetch: vi.fn().mockImplementation((path: string) => {
    const rows = path.includes('notification_rules')
      ? [{
          id: 'rule-1',
          user_id: 'user-1',
          pattern: IGNORED,
          pattern_type: 'exact',
          use_count: 0,
          last_used_at: null,
          created_at: new Date().toISOString(),
        }]
      : [];
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => rows,
      text: async () => JSON.stringify(rows),
    });
  }),
}));

const inserts: Array<Record<string, unknown>> = [];

function chainFor(table: string) {
  const chain: any = {};
  for (const method of [
    'select', 'eq', 'gte', 'lte', 'ilike', 'in', 'is', 'order', 'limit',
    'neq', 'gt', 'lt', 'not', 'update', 'delete', 'upsert',
  ]) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.insert = vi.fn((row: Record<string, unknown>) => {
    if (table === 'transactions') inserts.push(row);
    return chain;
  });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  chain.single = vi.fn().mockReturnValue(chain);
  chain.then = (onFulfilled: (value: { data: unknown[]; error: null }) => unknown) =>
    Promise.resolve().then(() => onFulfilled({ data: [], error: null }));
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

const CATEGORIES = [{ id: 'cat-other', name: 'Other' }];

/** The bank's new wording for the same gym charge. */
const REWORDED = 'ACME GYM MEMBERSHIP charged $45.00 to your credit card.';
/** Nothing to do with it. */
const ORDINARY = 'LOBLAWS #1042 You spent $84.21 with your credit card.';

beforeEach(() => {
  inserts.length = 0;
  mockLooksLikeIgnored.mockReset();
  mockLooksLikeIgnored.mockResolvedValue(false);
  _clearDedupCacheForTesting();
  _clearRecurringCacheForTesting();
  invalidateNotificationRulesCache();
});

function capture(text: string) {
  return processNotificationWithAI(
    'user-1',
    {
      rawNotification: text,
      bankAppId: 'com.bmo.mobile',
      bankName: 'BMO',
      notificationTimestamp: Date.now(),
    },
    CATEGORIES,
  );
}

describe('an alert the user ignores, reworded by the bank', () => {
  it('is skipped when the model says it is the same kind of thing', async () => {
    mockLooksLikeIgnored.mockResolvedValue(true);
    const result = await capture(REWORDED);

    expect(result.isTransaction).toBe(false);
    expect(result.skipReason).toBe('not_transaction');
    expect(result.rejectionReason).toMatch(/not a transaction/i);
    expect(inserts).toHaveLength(0);
  });

  it('is captured as normal when the model says no', async () => {
    mockLooksLikeIgnored.mockResolvedValue(false);
    const result = await capture(REWORDED);

    expect(result.isTransaction).toBe(true);
    expect(inserts).toHaveLength(1);
  });

  it('is captured as normal when there is no model to ask', async () => {
    // No runtime, no network, nothing downloaded — or a WebView that killed
    // the worker mid-inference. None of that is an opinion, and none of it may
    // be the reason a purchase goes uncaptured.
    mockLooksLikeIgnored.mockRejectedValue(new Error('model unavailable'));
    const result = await capture(REWORDED);
    expect(result.isTransaction).toBe(true);
    expect(inserts).toHaveLength(1);
  });

  it('is compared against the rule it actually resembles', async () => {
    mockLooksLikeIgnored.mockResolvedValue(true);
    await capture(REWORDED);
    expect(mockLooksLikeIgnored).toHaveBeenCalledWith(REWORDED, IGNORED);
  });
});

describe('an ordinary purchase', () => {
  it('is never put to the model at all', async () => {
    const result = await capture(ORDINARY);
    // The cheap wording gate settles this: a Loblaws charge shares nothing
    // with a gym membership alert, so no inference is spent and no verdict
    // about it can exist.
    expect(mockLooksLikeIgnored).not.toHaveBeenCalled();
    expect(result.isTransaction).toBe(true);
    expect(inserts).toHaveLength(1);
  });

  it('is still captured even if the model would have said yes', async () => {
    mockLooksLikeIgnored.mockResolvedValue(true);
    const result = await capture(ORDINARY);
    expect(mockLooksLikeIgnored).not.toHaveBeenCalled();
    expect(result.isTransaction).toBe(true);
  });
});

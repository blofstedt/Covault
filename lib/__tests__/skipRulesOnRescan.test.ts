import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A rule the user wrote outranks a rescan.
 *
 * "Not a transaction" writes a rule, and the pipeline applied it — except when
 * the capture was marked as coming from a scan, on the reasoning that a rescan
 * should be free to look again at things the app had rejected. That reasoning
 * holds for the app's own guesses. It does not hold for an instruction the user
 * gave.
 *
 * And it was not the rare case it sounds like. Everything captured while the
 * app is closed is handed over by drainPendingNotifications, which marks the
 * entire batch as a scan — so the rules were bypassed for exactly the captures
 * the user never watched happen. Alerts they had already marked as noise came
 * back into the ledger on the next launch, every launch.
 */

const restFetchMock = vi.fn();
vi.mock('../apiHelpers', () => ({
  restFetch: (...args: unknown[]) => restFetchMock(...args),
  REST_BASE: 'https://example.test/rest/v1',
  getAuthHeaders: async () => ({}),
}));

const inserts: Record<string, unknown[]> = {};

function tableChain(table: string) {
  const chain: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') {
          return (resolvefn: (value: unknown) => unknown) => resolvefn({ data: [], error: null });
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
import { invalidateNotificationRulesCache } from '../notificationRules';

const PROMO = 'BMO You spent $12.40 at Nowhere Cafe';

const SKIP_RULE = {
  id: 'rule-1',
  user_id: 'user-1',
  pattern: PROMO,
  pattern_type: 'exact',
  use_count: 0,
  last_used_at: null,
  created_at: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  for (const key of Object.keys(inserts)) delete inserts[key];
  _clearDedupCacheForTesting();
  invalidateNotificationRulesCache();
  restFetchMock.mockReset();
  restFetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => [SKIP_RULE],
    text: async () => '',
  });
});

async function capture(fromScan: boolean) {
  return processNotificationWithAI(
    'user-1',
    {
      rawNotification: PROMO,
      bankAppId: 'com.bmo.mobile',
      bankName: 'BMO',
      notificationTimestamp: Date.now(),
      forceReprocess: fromScan,
    },
    [{ id: 'cat-other', name: 'Other' }],
  );
}

describe('an alert the user marked "not a transaction"', () => {
  it('is skipped when it arrives live', async () => {
    const result = await capture(false);

    expect(result.isTransaction).toBe(false);
    expect(result.skipReason).toBe('not_transaction');
    expect(inserts.transactions).toBeUndefined();
  });

  it('is skipped when it comes back through a scan or the offline queue', async () => {
    const result = await capture(true);

    expect(result.isTransaction).toBe(false);
    expect(result.skipReason).toBe('not_transaction');
    expect(result.rejectionReason).toContain('user rule');
    expect(inserts.transactions).toBeUndefined();
  });

  it('still captures anything the rule does not match', async () => {
    restFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ ...SKIP_RULE, pattern: 'something else entirely' }],
      text: async () => '',
    });

    const result = await capture(true);

    expect(result.isTransaction).toBe(true);
    expect(inserts.transactions).toHaveLength(1);
  });
});

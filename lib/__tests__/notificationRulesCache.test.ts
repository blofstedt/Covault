import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock restFetch directly so these tests don't go through the auth-token
// retry loop in apiHelpers (which sleeps 8 x 200ms when there's no session).
const restFetchMock = vi.fn();
vi.mock('../apiHelpers', () => ({
  restFetch: (...args: unknown[]) => restFetchMock(...args),
  REST_BASE: 'https://example.test/rest/v1',
  getAuthHeaders: async () => ({}),
}));

import {
  checkNotificationRules,
  createNotificationRule,
  deleteNotificationRule,
  invalidateNotificationRulesCache,
} from '../notificationRules';

const rule = {
  id: 'r1',
  user_id: 'u1',
  pattern: 'balance alert',
  pattern_type: 'contains',
  use_count: 0,
  last_used_at: null,
  created_at: '2026-01-01T00:00:00Z',
};

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => '' });

describe('notification rules cache', () => {
  beforeEach(() => {
    restFetchMock.mockReset();
    invalidateNotificationRulesCache();
  });

  it('fetches once and serves repeat checks from cache', async () => {
    restFetchMock.mockResolvedValue(okJson([rule]));

    await checkNotificationRules('u1', 'your balance alert is ready');
    await checkNotificationRules('u1', 'another balance alert');
    await checkNotificationRules('u1', 'a third balance alert');

    // Only the rules GET should have happened once. bumpRuleUseCount is not
    // involved here because checkNotificationRules doesn't call it.
    const ruleFetches = restFetchMock.mock.calls.filter(([path]) =>
      String(path).startsWith('/notification_rules?select='),
    );
    expect(ruleFetches).toHaveLength(1);
  });

  it('still returns the correct match from the cached rows', async () => {
    restFetchMock.mockResolvedValue(okJson([rule]));

    const first = await checkNotificationRules('u1', 'your balance alert is ready');
    const second = await checkNotificationRules('u1', 'your balance alert is ready');

    expect(first?.id).toBe('r1');
    expect(second?.id).toBe('r1');
    expect(await checkNotificationRules('u1', 'purchase of $12 at cafe')).toBeNull();
  });

  it('refetches for a different user rather than serving another user rows', async () => {
    restFetchMock.mockResolvedValue(okJson([rule]));

    await checkNotificationRules('u1', 'balance alert');
    await checkNotificationRules('u2', 'balance alert');

    const ruleFetches = restFetchMock.mock.calls.filter(([path]) =>
      String(path).startsWith('/notification_rules?select='),
    );
    expect(ruleFetches).toHaveLength(2);
    expect(String(ruleFetches[1][0])).toContain('user_id=eq.u2');
  });

  it('invalidates after creating a rule so it applies immediately', async () => {
    restFetchMock.mockResolvedValue(okJson([rule]));
    await checkNotificationRules('u1', 'balance alert');

    restFetchMock.mockResolvedValue(okJson([rule]));
    await createNotificationRule('u1', { pattern: 'otp code' });

    restFetchMock.mockResolvedValue(okJson([rule]));
    await checkNotificationRules('u1', 'balance alert');

    const ruleFetches = restFetchMock.mock.calls.filter(([path]) =>
      String(path).startsWith('/notification_rules?select='),
    );
    expect(ruleFetches).toHaveLength(2);
  });

  it('invalidates after deleting a rule', async () => {
    restFetchMock.mockResolvedValue(okJson([rule]));
    await checkNotificationRules('u1', 'balance alert');

    restFetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => null, text: async () => '' });
    await deleteNotificationRule('u1', 'r1');

    restFetchMock.mockResolvedValue(okJson([]));
    await checkNotificationRules('u1', 'balance alert');

    const ruleFetches = restFetchMock.mock.calls.filter(([path]) =>
      String(path).startsWith('/notification_rules?select='),
    );
    expect(ruleFetches).toHaveLength(2);
  });

  it('does not cache a failed fetch', async () => {
    restFetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => null, text: async () => '' });
    expect(await checkNotificationRules('u1', 'balance alert')).toBeNull();

    restFetchMock.mockResolvedValue(okJson([rule]));
    expect((await checkNotificationRules('u1', 'balance alert'))?.id).toBe('r1');
  });
});

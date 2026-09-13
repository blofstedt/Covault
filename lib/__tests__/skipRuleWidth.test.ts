import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocked for the same reason notificationRulesCache.test.ts mocks it: the real
// restFetch sits behind an auth-token retry loop that sleeps without a session.
const restFetchMock = vi.fn();
vi.mock('../apiHelpers', () => ({
  restFetch: (...args: unknown[]) => restFetchMock(...args),
  REST_BASE: 'https://example.test/rest/v1',
  getAuthHeaders: async () => ({}),
}));

type PushedRule = { pattern: string; pattern_type: string };
const pushSkipRulesMock = vi.fn(async (_rules: PushedRule[]) => true);
vi.mock('../covaultNotification', () => ({
  covaultNotification: { pushSkipRules: () => Promise.resolve(true) },
  pushSkipRules: (rules: PushedRule[]) => pushSkipRulesMock(rules),
}));

import {
  checkNotificationRules,
  updateNotificationRulePatternType,
  invalidateNotificationRulesCache,
} from '../notificationRules';

const rule = {
  id: 'r1',
  user_id: 'u1',
  pattern: 'Your Points balance is 12,340',
  pattern_type: 'exact',
  use_count: 4,
  last_used_at: '2026-02-02T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
};

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => '' });
const noContent = { ok: true, status: 204, json: async () => null, text: async () => '' };

/**
 * A skip rule is created from the whole text of one alert, so the thing the
 * user gets wrong is not the words — it is how widely the rule should look.
 * Changing that has to reach both copies of the rules: the web pipeline
 * decides whether a row is written, but the "captured" notification is posted
 * by a service running with the WebView dead, so a change known only to the
 * app silences the row and leaves the notification.
 */
describe('changing a skip pattern between exact and contains', () => {
  beforeEach(() => {
    restFetchMock.mockReset();
    pushSkipRulesMock.mockClear();
    invalidateNotificationRulesCache();
  });

  it('patches only the match type, leaving the pattern and its count alone', async () => {
    restFetchMock.mockResolvedValue(noContent);

    expect(await updateNotificationRulePatternType('u1', 'r1', 'contains')).toBe(true);

    const [path, init] = restFetchMock.mock.calls[0];
    expect(String(path)).toContain('id=eq.r1');
    // Scoped to the owner as every other write here is: an id alone is a row
    // reference, not a permission.
    expect(String(path)).toContain('user_id=eq.u1');
    expect((init as { method: string }).method).toBe('PATCH');
    const body = JSON.parse((init as { body: string }).body);
    expect(body).toEqual({ pattern_type: 'contains' });
  });

  it('takes effect on the very next notification rather than after the cache expires', async () => {
    // As it stands the rule is exact, so an alert that merely carries this
    // text inside a longer sentence goes straight past it.
    const wider = 'Rewards update: Your Points balance is 12,340 — see details';
    restFetchMock.mockResolvedValue(okJson([rule]));
    expect(await checkNotificationRules('u1', wider)).toBeNull();

    restFetchMock.mockImplementation(async (path: string) =>
      String(path).startsWith('/notification_rules?select=')
        ? okJson([{ ...rule, pattern_type: 'contains' }])
        : noContent,
    );
    await updateNotificationRulePatternType('u1', 'r1', 'contains');

    // Matching now is the whole point: the cached copy still says exact, so a
    // match here can only mean the change was picked up rather than waiting
    // out the cache. The alert a user wants silenced is usually the next one.
    expect((await checkNotificationRules('u1', wider))?.id).toBe('r1');
  });

  it('pushes the changed rule down to the listener', async () => {
    // The PATCH and the re-read that feeds the native copy both go through
    // restFetch; the re-read is the one whose answer matters here.
    restFetchMock.mockImplementation(async (path: string) =>
      String(path).startsWith('/notification_rules?select=')
        ? okJson([{ ...rule, pattern_type: 'contains' }])
        : noContent,
    );
    await updateNotificationRulePatternType('u1', 'r1', 'contains');
    // The refresh is fire-and-forget, so let its microtasks run.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const pushed = pushSkipRulesMock.mock.calls.at(-1)?.[0];
    expect(pushed, 'the native copy must be told, or the row is skipped and the notification is not')
      .toBeTruthy();
    expect(pushed?.[0].pattern_type).toBe('contains');
  });

  it('takes a shortened rule back to the whole alert when it is set to exact', async () => {
    // A `contains` rule may be three words out of the middle of an alert.
    // Under `exact` those three words would mean "an alert consisting of these
    // three words and nothing else", which no bank sends — so the rule would
    // stop firing, in silence, while the list went on showing it.
    restFetchMock.mockResolvedValue(noContent);

    await updateNotificationRulePatternType(
      'u1', 'r1', 'exact', 'Rewards: Your points are calculated to be 12,340',
    );

    const body = JSON.parse((restFetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.pattern_type).toBe('exact');
    expect(body.pattern).toBe('Rewards: Your points are calculated to be 12,340');
  });

  it('leaves the pattern alone going the other way', async () => {
    // Widening does not need to touch it: the whole alert is a valid
    // `contains` pattern, and the words the user picks come next.
    restFetchMock.mockResolvedValue(noContent);

    await updateNotificationRulePatternType('u1', 'r1', 'contains', 'the whole alert');

    const body = JSON.parse((restFetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body).not.toHaveProperty('pattern');
  });

  it('leaves the rules alone when the write fails', async () => {
    restFetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => null, text: async () => 'no' });
    expect(await updateNotificationRulePatternType('u1', 'r1', 'contains')).toBe(false);
  });
});

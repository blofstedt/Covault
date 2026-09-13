import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocked for the same reason notificationRulesCache.test.ts mocks it: the real
// restFetch sits behind an auth-token retry loop that sleeps without a session.
const restFetchMock = vi.fn();
vi.mock('../apiHelpers', () => ({
  restFetch: (...args: unknown[]) => restFetchMock(...args),
  REST_BASE: 'https://example.test/rest/v1',
  getAuthHeaders: async () => ({}),
}));

import { bumpRuleUseCount, readRecentUses, MAX_RECENT_USES } from '../notificationRules';
import type { NotificationRule, RuleUse } from '../notificationRules';

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => '' });
const badRequest = { ok: false, status: 400, json: async () => null, text: async () => 'unknown column' };
const noContent = { ok: true, status: 204, json: async () => null, text: async () => '' };

const patchBody = () => {
  const call = restFetchMock.mock.calls.find(([, init]) => (init as { method?: string })?.method === 'PATCH');
  return call ? JSON.parse((call[1] as { body: string }).body) : null;
};

/**
 * A skip rule silences alerts the user never sees. The count alone cannot say
 * whether what it silenced was the noise they meant or a purchase now lost, so
 * the rule keeps the last few alerts it actually fired on — the one place that
 * wording survives at all, since a skipped notification becomes no row, no
 * review item and no log.
 */
describe('what a skip rule remembers about its own uses', () => {
  beforeEach(() => {
    restFetchMock.mockReset();
  });

  it('stores the alert alongside the count', async () => {
    restFetchMock.mockImplementation(async (_path: string, init?: { method?: string }) =>
      init?.method === 'PATCH'
        ? noContent
        : okJson([{ use_count: 2, recent_uses: [] }]),
    );

    await bumpRuleUseCount('r1', '  BTC is trading  at $112,013.15  ');

    const body = patchBody();
    expect(body.use_count).toBe(3);
    expect(body.recent_uses).toHaveLength(1);
    // Whitespace is squeezed so the stored line reads as one line.
    expect(body.recent_uses[0].text).toBe('BTC is trading at $112,013.15');
    expect(typeof body.recent_uses[0].at).toBe('string');
  });

  it('keeps the newest first and never more than five', async () => {
    const existing: RuleUse[] = Array.from({ length: MAX_RECENT_USES }, (_, i) => ({
      at: `2026-09-0${i + 1}T00:00:00.000Z`,
      text: `older alert ${i}`,
    }));
    restFetchMock.mockImplementation(async (_path: string, init?: { method?: string }) =>
      init?.method === 'PATCH'
        ? noContent
        : okJson([{ use_count: 9, recent_uses: existing }]),
    );

    await bumpRuleUseCount('r1', 'the newest alert');

    const body = patchBody();
    expect(body.recent_uses).toHaveLength(MAX_RECENT_USES);
    expect(body.recent_uses[0].text).toBe('the newest alert');
    // The oldest falls off rather than the list growing without bound.
    expect(body.recent_uses.map((u: RuleUse) => u.text)).not.toContain('older alert 4');
  });

  it('still counts the use on a database without the column', async () => {
    // The count is the older, load-bearing half — it is what the rules list has
    // always shown — so a select naming a column this database does not have
    // must not take it down with it.
    restFetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (init?.method === 'PATCH') return noContent;
      return String(path).includes('recent_uses') ? badRequest : okJson([{ use_count: 4 }]);
    });

    await bumpRuleUseCount('r2', 'an alert');

    const body = patchBody();
    expect(body.use_count).toBe(5);
    expect(body).not.toHaveProperty('recent_uses');
  });

  it('reads back only well-formed entries', () => {
    const rule = {
      id: 'r1',
      recent_uses: [
        { at: '2026-09-01T00:00:00.000Z', text: 'good' },
        { at: 123, text: 'bad at' },
        { text: 'no at' },
        null,
      ],
    } as unknown as NotificationRule;
    expect(readRecentUses(rule).map((u) => u.text)).toEqual(['good']);
  });

  it('reads an absent column as no uses rather than throwing', () => {
    expect(readRecentUses({ id: 'r1' } as unknown as NotificationRule)).toEqual([]);
  });
});

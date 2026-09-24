// The Review page's skip rules are a cached, prefetched query. What matters is
// that a failed read keeps the rules on screen instead of wiping them, that the
// walkthrough never asks the database for a user called "tour", and that the
// cache is wired in at the root and warmed from the Review button.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryClient } from '@tanstack/react-query';

const restFetch = vi.fn();
vi.mock('../apiHelpers', () => ({ restFetch: (...args: unknown[]) => restFetch(...args) }));
vi.mock('../covaultNotification', () => ({
  covaultNotification: null,
  pushSkipRules: () => Promise.resolve(true),
}));

import { fetchNotificationRuleList, listNotificationRules } from '../notificationRules';
import {
  canFetchNotificationRules,
  notificationRulesKey,
  notificationRulesQuery,
  prefetchNotificationRules,
} from '../queries/notificationRules';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const ok = (rows: unknown[]) => Response.json(rows, { status: 200 });
const RULE = { id: 'r1', user_id: 'u1', pattern: 'price alert', pattern_type: 'contains' };

beforeEach(() => restFetch.mockReset());

describe('reading the rules list', () => {
  it('throws on a failed read rather than answering "no rules"', async () => {
    restFetch.mockResolvedValue(new Response('nope', { status: 401 }));
    await expect(fetchNotificationRuleList('u1')).rejects.toThrow(/401/);
  });

  it('the old non-throwing reader still answers [] for its callers', async () => {
    restFetch.mockResolvedValue(new Response('nope', { status: 500 }));
    await expect(listNotificationRules('u1')).resolves.toEqual([]);
  });

  it('a failed refetch leaves the cached rules in place', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    restFetch.mockResolvedValueOnce(ok([RULE]));
    await client.fetchQuery(notificationRulesQuery('u1'));
    restFetch.mockResolvedValueOnce(new Response('', { status: 401 }));
    await client.refetchQueries({ queryKey: notificationRulesKey('u1') });
    expect(client.getQueryData(notificationRulesKey('u1'))).toEqual([RULE]);
  });
});

describe('prefetching', () => {
  it('never fetches for the walkthrough or a signed-out user', () => {
    expect(canFetchNotificationRules('tour')).toBe(false);
    expect(canFetchNotificationRules(undefined)).toBe(false);
    const client = new QueryClient();
    prefetchNotificationRules(client, 'tour');
    prefetchNotificationRules(client, undefined);
    expect(restFetch).not.toHaveBeenCalled();
  });

  it('a second prefetch while the list is fresh costs no request', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
    restFetch.mockResolvedValue(ok([RULE]));
    prefetchNotificationRules(client, 'u1');
    await vi.waitFor(() => expect(client.getQueryData(notificationRulesKey('u1'))).toEqual([RULE]));
    prefetchNotificationRules(client, 'u1');
    expect(restFetch).toHaveBeenCalledTimes(1);
  });
});

describe('wiring', () => {
  it('the cache sits at the root of the app', () => {
    expect(read('index.tsx')).toMatch(/<QueryClientProvider client=\{queryClient\}>/);
  });

  it('the Review button warms the cache before the tap completes', () => {
    const bar = read('components/dashboard_components/DashboardBottomBar.tsx');
    expect(bar).toMatch(/onPointerDown=\{onPrefetchParsing\}/);
    expect(read('components/Dashboard.tsx')).toMatch(/onPrefetchParsing=\{prefetchReview\}/);
  });

  it('signing out empties the cache, so the next person never sees these rules', () => {
    const auth = read('lib/hooks/useAuthState.ts');
    expect(auth.match(/queryClient\.clear\(\)/g)?.length).toBe(
      auth.match(/clearFirstPaintCache\(\)/g)?.length,
    );
  });

  it('the Review page reads the rules through the cache', () => {
    const hook = read('components/transaction_parsing/useNotificationRules.ts');
    expect(hook).toMatch(/useQuery\(/);
    expect(hook).not.toMatch(/useState/);
  });
});

/**
 * `persistVendorOverride` is one of the two places a rule actually gets
 * written (the other is `handleSetVendorCategory` in useVendorOverrides.ts,
 * pinned separately since it isn't a standalone function). Two behaviours
 * pinned here:
 *
 *   - Other is never taught as a rule. The transaction itself is filed by
 *     the caller regardless; this only ever governs the "remember this"
 *     side effect.
 *   - A known chain's match_key is generalised to the chain's own name when
 *     a branch is appended, and the existing-row lookup is scoped to the
 *     SAME category — so a sibling branch that disagrees creates a second
 *     rule instead of silently overwriting the first.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { persistVendorOverride } from '../vendorOverrideWrite';

const restFetchMock = vi.fn();
vi.mock('../apiHelpers', () => ({
  restFetch: (...args: unknown[]) => restFetchMock(...args),
}));

function jsonResponse(ok: boolean, body: unknown) {
  return {
    ok,
    status: ok ? 200 : 404,
    text: async () => JSON.stringify(body),
  } as Response;
}

beforeEach(() => {
  restFetchMock.mockReset();
});

describe('persistVendorOverride — Other is never taught', () => {
  it('makes no network call at all when the category is Other', async () => {
    await persistVendorOverride({
      userId: 'u1',
      properName: 'Amazon',
      matchKey: 'amznmktpca',
      categoryName: 'Other',
      ilikeFallbackName: 'Amazon',
    });
    expect(restFetchMock).not.toHaveBeenCalled();
  });

  it('is case- and whitespace-insensitive about "Other"', async () => {
    await persistVendorOverride({
      userId: 'u1',
      properName: 'Amazon',
      matchKey: 'amznmktpca',
      categoryName: '  other ',
      ilikeFallbackName: 'Amazon',
    });
    expect(restFetchMock).not.toHaveBeenCalled();
  });

  it('still writes a real category normally', async () => {
    restFetchMock.mockResolvedValueOnce(jsonResponse(true, [{ id: 'row1' }]));
    await persistVendorOverride({
      userId: 'u1',
      properName: 'Amazon',
      matchKey: 'amznmktpca',
      categoryName: 'Shopping',
      ilikeFallbackName: 'Amazon',
    });
    expect(restFetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('persistVendorOverride — teaches the chain for a known chain', () => {
  it('writes a prefix rule keyed to the chain, not the branch', async () => {
    restFetchMock.mockResolvedValueOnce(jsonResponse(true, [{ id: 'row1' }]));
    await persistVendorOverride({
      userId: 'u1',
      properName: "Wendy's",
      matchKey: 'wendyscrowfoot',
      categoryName: 'Leisure',
      ilikeFallbackName: "Wendy's Crowfoot",
    });

    const [url, init] = restFetchMock.mock.calls[0];
    expect(url).toContain('match_key=eq.wendys');
    expect(url).not.toContain('wendyscrowfoot');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.match_key).toBe('wendys');
    expect(body.match_type).toBe('prefix');
  });

  it('scopes the lookup to the same category, so a disagreeing sibling branch is not overwritten', async () => {
    restFetchMock.mockResolvedValueOnce(jsonResponse(true, [{ id: 'row1' }]));
    await persistVendorOverride({
      userId: 'u1',
      properName: "Wendy's",
      matchKey: 'wendysolympic',
      categoryName: 'Leisure',
      ilikeFallbackName: "Wendy's Olympic",
    });

    const [url] = restFetchMock.mock.calls[0];
    expect(url).toContain('category_id=eq.Leisure');
  });

  it('falls through to insert when the existing chain rule disagrees, rather than overwriting it', async () => {
    // The match_key+category-scoped PATCH finds nothing (a "wendys" row
    // exists, but under a different category) — a 200 with zero rows, which
    // PostgREST treats as success, so the ilike fallback (only tried on a
    // non-ok response) never runs either. The function must then INSERT a
    // second rule rather than silently doing nothing.
    restFetchMock
      .mockResolvedValueOnce(jsonResponse(true, [])) // scoped PATCH: 0 rows, still ok
      .mockResolvedValueOnce(jsonResponse(true, [{ id: 'new-row' }])); // insert

    await persistVendorOverride({
      userId: 'u1',
      properName: "Wendy's",
      matchKey: 'wendyscrowfoot',
      categoryName: 'Services',
      ilikeFallbackName: "Wendy's Crowfoot",
    });

    expect(restFetchMock).toHaveBeenCalledTimes(2);
    const insertCall = restFetchMock.mock.calls[1];
    expect(insertCall[0]).toBe('/overrides');
    const insertBody = JSON.parse((insertCall[1] as RequestInit).body as string);
    expect(insertBody.match_key).toBe('wendys');
    expect(insertBody.category_id).toBe('Services');
  });

  it('never scopes an EXACT rule by category — an ordinary correction still updates in place', async () => {
    // This is the plain, non-chain case: re-approving the same merchant with
    // a DIFFERENT category than before must still update the one existing
    // rule, not spawn a second row every time someone corrects themselves.
    restFetchMock.mockResolvedValueOnce(jsonResponse(true, [{ id: 'existing-row' }]));
    await persistVendorOverride({
      userId: 'u1',
      properName: 'Rosso Coffee Roasters',
      matchKey: 'rossocoffeeroasters',
      categoryName: 'Groceries', // was previously taught as something else
      ilikeFallbackName: 'Rosso Coffee Roasters',
    });
    expect(restFetchMock).toHaveBeenCalledTimes(1);
    const [url] = restFetchMock.mock.calls[0];
    expect(url).not.toContain('category_id=eq.');
  });

  it('updates an existing chain rule in place when the category agrees', async () => {
    restFetchMock.mockResolvedValueOnce(jsonResponse(true, [{ id: 'existing-row' }]));
    await persistVendorOverride({
      userId: 'u1',
      properName: "Wendy's",
      matchKey: 'wendyscochrane',
      categoryName: 'Leisure',
      ilikeFallbackName: "Wendy's Cochrane",
    });
    // One call: the scoped PATCH found and updated the existing "wendys"
    // rule — no second network round-trip needed.
    expect(restFetchMock).toHaveBeenCalledTimes(1);
    expect(restFetchMock.mock.calls[0][1].method).toBe('PATCH');
  });
});

describe('persistVendorOverride — an ordinary vendor is untouched', () => {
  it('keeps the exact key and match_type for a non-chain vendor', async () => {
    restFetchMock.mockResolvedValueOnce(jsonResponse(true, [{ id: 'row1' }]));
    await persistVendorOverride({
      userId: 'u1',
      properName: 'Rosso Coffee Roasters',
      matchKey: 'rossocoffeeroasters',
      categoryName: 'Leisure',
      ilikeFallbackName: 'Rosso Coffee Roasters',
    });
    const [url, init] = restFetchMock.mock.calls[0];
    expect(url).toContain('match_key=eq.rossocoffeeroasters');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.match_type).toBe('exact');
    expect(body.match_key).toBe('rossocoffeeroasters');
  });
});

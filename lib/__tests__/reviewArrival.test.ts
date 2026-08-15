import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * Guards what happens when a capture notification (or the widget's review
 * pill) sends the user to Review.
 *
 * Three things have to hold together, and each of them has already been wrong:
 *
 *   1. The page paints before the network answers. Everything on it derives
 *      from `transactions`, which used to start every launch empty — so the
 *      page the notification opened said "All caught up" for as long as the
 *      fetch took, which is the opposite of what the notification said.
 *   2. The arrival lands on the captures, not on the top of the page.
 *   3. The light runs around rows that exist. It used to fire on arrival
 *      unconditionally, which on a cold start meant firing at an empty list —
 *      the one moment it was asked for was the one moment it had nothing to
 *      point at, so the feature looked like it had never been built.
 *
 * These are structural, not visual: nothing in CI renders this app, so what
 * can be checked is that the wiring is still present.
 */

const ROOT = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('arriving at Review from a notification', () => {
  it('paints from the cache before the fetches, not after', () => {
    const src = read('lib/hooks/useDataLoading.ts');

    expect(src).toContain('readFirstPaintCache');

    // Ordering is the whole point: hydrating after the round-trips would be a
    // no-op for the second the user is actually waiting.
    const hydrate = src.indexOf('hydrateFromCache(userId)');
    const fetches = src.indexOf('await Promise.all(');
    expect(hydrate).toBeGreaterThan(-1);
    expect(fetches).toBeGreaterThan(-1);
    expect(hydrate).toBeLessThan(fetches);
  });

  it('only paints the cache into empty state', () => {
    const src = read('lib/hooks/useDataLoading.ts');
    // A reload mid-session (token refresh, resume) must never see cached rows
    // overwrite live ones — deleted rows would reappear until the fetch landed.
    expect(src).toContain('prev.transactions.length === 0');
    expect(src).toContain('prev.budgets.length === 0');
  });

  it('drops the cache on sign-out', () => {
    expect(read('lib/hooks/useAuthState.ts')).toContain('clearFirstPaintCache');
  });

  it('scrolls the arrival to the capture section, expanded', () => {
    const src = read('components/TransactionParsing.tsx');
    expect(src).toContain('reviewCardRef');
    // Scrolling to a collapsed section arrives at nothing, so the section is
    // opened as part of the arrival.
    expect(src).toMatch(/caughtTransactions: true/);
    expect(src).toContain('scrollTo(');
  });

  it('holds the light until there are rows to light', () => {
    const src = read('components/transaction_parsing/AITransactionsEnteredCard.tsx');
    expect(src).toContain('if (nonRefunds.length === 0) return;');
    // Once per arrival: the effect now also runs when the rows change, and
    // filing a row must not replay the light around the ones left behind.
    expect(src).toContain('playedNonceRef');
  });

  it('lowers the nonce when the user leaves Review', () => {
    // Otherwise the counter stays raised for the session and the next manual
    // visit scrolls and lights up as though a notification had sent them.
    expect(read('components/Dashboard.tsx')).toContain('setReviewHighlightNonce(0)');
  });
});

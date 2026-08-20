import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * A shared vault's other half must survive a reload.
 *
 * `loadTransactions` REPLACES the list and its query is scoped to one user_id.
 * The partner's rows were merged on top afterwards by `loadHouseholdLink` —
 * but only there, and only during a full `loadUserData`. Every other reload
 * (a capture landing, filing a caught row, the Review page's scan button) calls
 * `loadTransactions` with the signed-in user alone, which threw the partner's
 * spending straight back out of app state.
 *
 * On a shared vault that is not a missing list, it is a wrong number on the
 * screen: the donut, the vials and "remaining" all silently rose by whatever
 * the partner had spent this month, until the next cold start put it back. The
 * failure mode has no error and no empty state — it just reads as more money
 * than there is.
 *
 * There is no React renderer in this project's test setup, so the wiring is
 * pinned by reading it. Every clause below is one way the fix can be undone
 * without anything else in the repo noticing.
 */

const root = resolve(__dirname, '../..');
const source = readFileSync(resolve(root, 'lib/hooks/useDataLoading.ts'), 'utf8');

describe('a replace-load carries both halves', () => {
  it('remembers who the partner is between loads', () => {
    expect(source).toContain('partnerIdRef');
    expect(source).toContain('partnerOwnerIdRef');
  });

  it('records the partner when the household link is read', () => {
    expect(source).toContain('partnerIdRef.current =');
    expect(source).toContain('partnerOwnerIdRef.current = userId');
  });

  it('fetches the partner alongside the signed-in user on a replace', () => {
    // The guard has to be `!merge`: the merge path is the one loadHouseholdLink
    // itself uses, and re-entering from there would recurse.
    expect(source).toContain('if (!merge && partnerId && partnerId !== userId)');
    expect(source).toContain('mergeTransactions(own, partnerRows)');
  });

  it('only trusts the remembered partner for the account it belongs to', () => {
    // A different account signing in must not inherit the previous one's
    // partner. RLS would refuse the read anyway, but "the read comes back
    // empty" is a weak thing to be relying on for correctness.
    expect(source).toContain('partnerOwnerIdRef.current === userId ? partnerIdRef.current : null');
  });
});

describe('a failed read still cannot empty the dashboard', () => {
  it('distinguishes "no rows" from "no answer"', () => {
    // The fetch helper returns null for a failed request and [] for a genuinely
    // empty one. Collapsing the two would let a network blip clear the month.
    expect(source).toContain('Promise<Transaction[] | null>');
    expect(source).toContain('if (own === null) return;');
  });

  it('keeps the read gate on the replace path', () => {
    // Two loads are routinely in flight at once and the older one must not win.
    // See lib/readGate.ts — this is the guard that stopped a slow launch read
    // from putting back the list from before a capture.
    expect(source).toContain('transactionReads.take()');
    expect(source).toContain('!merge && !transactionReads.accepts(ticket)');
  });

  it('does not block the whole reload on the partner half', () => {
    // The signed-in user's own rows are the important ones. A partner read that
    // comes back empty or fails leaves them on screen rather than taking them
    // down too.
    expect(source).toContain('if (partnerRows && partnerRows.length > 0)');
  });
});

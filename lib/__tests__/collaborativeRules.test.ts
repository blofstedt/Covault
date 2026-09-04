import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { classifyMatch } from '../hooks/useVendorMatcher';

/**
 * The shared rule layers, and the three promises that make them safe.
 *
 * Nothing here renders or captures anything, so these are the only things in
 * the build that can notice if a borrowed rule quietly gains the authority of
 * one the user wrote themselves.
 */

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('what a borrowed rule is allowed to do', () => {
  it('is never mistaken for a rule the user wrote', () => {
    // Emerald, and the word "exact", mean "you decided this". A partner's rule
    // and the pool's are a suggestion nobody in this household has agreed to
    // yet, and they get their own kind.
    expect(classifyMatch({ hasOverrideMatch: true, confidence: null, hasBudget: true, matchSource: 'own' }))
      .toBe('exact');
    expect(classifyMatch({ hasOverrideMatch: true, confidence: null, hasBudget: true, matchSource: 'partner' }))
      .toBe('borrowed');
    expect(classifyMatch({ hasOverrideMatch: true, confidence: null, hasBudget: true, matchSource: 'community' }))
      .toBe('borrowed');
  });

  it('still reads as the user\'s own when no source is given', () => {
    // Callers that predate the layers pass no source at all; they are asking
    // about the user's own rules, and must keep getting the old answer.
    expect(classifyMatch({ hasOverrideMatch: true, confidence: null, hasBudget: true }))
      .toBe('exact');
  });

  it('never carries a match confidence, so it can never auto-file', () => {
    // The capture pipeline's one gate on filing money unseen is
    // overrideMatchConfidence clearing AUTO_ACCEPT_MIN_CONFIDENCE. The borrowed
    // branch must never write to it — the same treatment the model's guess and
    // the offline descriptor hint already get.
    const pipeline = stripComments(read('lib/notificationProcessor.ts'));
    // Anchored on code rather than on a comment: the whole point is that a
    // comment saying "never scored" cannot enforce anything.
    const start = pipeline.indexOf('await fetchPartnerRules(userId)');
    const borrowed = pipeline.slice(start, pipeline.indexOf('getVendorMapEntry(parsed.vendorKey)'));

    expect(start, 'the borrowed-layer branch has been renamed or removed').toBeGreaterThan(-1);
    expect(borrowed).toContain('lookupCommunityRule');
    expect(
      /overrideMatchConfidence\s*=/.test(borrowed),
      'A partner or community match must leave overrideMatchConfidence at 0. ' +
      'Scoring one would let a rule the user has never agreed to file money ' +
      'without ever appearing in Review.',
    ).toBe(false);
  });

  it('is not consulted when the user\'s own rules conflict', () => {
    // Two of the user's own rules disagreeing means this household has not
    // settled the merchant. Answering with somebody else's opinion would be
    // worse than asking.
    const pipeline = stripComments(read('lib/notificationProcessor.ts'));
    expect(pipeline).toContain('if (!categoryId && !overrideRuleConflict) {');
  });

  it('is never swept up by the bulk accept', async () => {
    // Bulk accept exists to ratify a screenful of the user's OWN past
    // decisions. A borrowed suggestion is not one of those, and filing a
    // screenful of them in a tap would agree to rules nobody in this household
    // had ever seen — and adopt none of them, since adoption happens on the
    // single-row accept.
    const { selectBulkAcceptable } = await import('../hooks/useVendorMatcher');
    const rule = {
      id: 'r1', proper_name: 'Costco', match_key: 'costco',
      match_type: 'exact' as const, category_id: 'budget:groceries',
    };
    const rows = [
      { id: 'own', vendor: 'Costco', confidence: null, budget_id: 'b1' },
      { id: 'borrowed', vendor: 'Costco', confidence: null, budget_id: 'b1' },
    ] as any[];
    const matches = new Map([
      ['own', { match: rule, state: 'exact' as const, source: 'own' as const }],
      ['borrowed', { match: rule, state: 'exact' as const, source: 'partner' as const }],
    ]);

    const acceptable = selectBulkAcceptable(rows, matches, () => true);
    expect(acceptable.map((tx) => tx.id)).toEqual(['own']);
  });

  it('never reaches the home-screen widget', () => {
    // The native matcher has its own auto-file threshold and runs with the app
    // closed. A borrowed rule mirrored to it would file money with nobody
    // watching — the one thing this design refuses.
    const dashboard = stripComments(read('components/Dashboard.tsx'));
    const push = dashboard.slice(dashboard.indexOf('const rules: WidgetVendorRule[]'));
    expect(push).toContain('vendorOverrides.map');
    expect(
      /partnerOverrides|communityRules|lookupCommunityRule/.test(push.slice(0, 400)),
      'Only the user\'s own rules may be mirrored to the phone.',
    ).toBe(false);
  });
});

class MemoryStorage {
  private store: Record<string, string> = {};
  getItem(key: string) { return key in this.store ? this.store[key] : null; }
  setItem(key: string, value: string) { this.store[key] = value; }
  removeItem(key: string) { delete this.store[key]; }
  clear() { this.store = {}; }
}

describe('the community pool', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    vi.resetModules();
  });

  it('answers nothing at all when it has no pack', async () => {
    // Fail closed. A stale, empty or unreachable pack must mean "no community
    // answer" and fall through to the guesses below it — never a wrong answer.
    const { lookupCommunityRule } = await import('../communityRules');
    expect(lookupCommunityRule('costco')).toBeNull();
  });

  it('answers on the whole key only, never on a fragment', async () => {
    const { lookupCommunityRule } = await import('../communityRules');
    localStorage.setItem(
      'covault_community_rules_v1',
      JSON.stringify({ fetchedAt: Date.now(), rules: [{ matchKey: 'costco', category: 'Groceries' }] }),
    );
    expect(lookupCommunityRule('costco')?.category).toBe('Groceries');
    // A stranger's short key matching by substring is the case the confidence
    // scoring exists to distrust, and here nobody is watching.
    expect(lookupCommunityRule('costcogas')).toBeNull();
    expect(lookupCommunityRule('cost')).toBeNull();
  });

  it('says nothing when the user has switched it off', async () => {
    const { lookupCommunityRule, setCommunityFlags } = await import('../communityRules');
    localStorage.setItem(
      'covault_community_rules_v1',
      JSON.stringify({ fetchedAt: Date.now(), rules: [{ matchKey: 'costco', category: 'Groceries' }] }),
    );
    setCommunityFlags({ enabled: false });
    expect(lookupCommunityRule('costco')).toBeNull();
  });

  it('receives by default and sends only when asked', async () => {
    const { getCommunityFlags } = await import('../communityRules');
    const flags = getCommunityFlags();
    expect(flags.enabled, 'receiving costs the user nothing and sends nothing').toBe(true);
    expect(flags.contribute, 'contributing must never be a default').toBe(false);
  });

  it('contributes nothing while the switch is off', async () => {
    const fetchSpy = vi.fn();
    vi.doMock('../apiHelpers', () => ({ restFetch: fetchSpy }));
    const { contributeRule } = await import('../communityRules');
    await contributeRule('user-1', 'costco', 'Groceries');
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.doUnmock('../apiHelpers');
  });
});

describe('what the pool is told, and what it can be asked', () => {
  const source = read('lib/communityRules.ts');
  const migration = read('supabase/migrations/2026_09_collaborative_rules.sql');

  it('sends a merchant and a category, and nothing else', () => {
    const body = source.slice(source.indexOf('export async function contributeRule'));
    const payload = body.slice(
      body.indexOf('JSON.stringify({') + 'JSON.stringify({'.length,
      body.indexOf('}),'),
    );
    const fields = (payload.match(/^\s*([a-z_]+):/gm) || [])
      .map((line) => line.trim().replace(':', ''));

    // The exact list, not a search for known-bad words: a contribution is a
    // fact about a shop, and anything else appearing here would be a fact
    // about a person.
    expect(fields.sort()).toEqual(['category_id', 'match_key', 'user_id']);
  });

  it('is downloaded, never asked about a purchase', () => {
    // A per-capture lookup would hand the server a live feed of where this
    // household shops — strictly worse than the app was before the feature.
    expect(source).toContain('/community_rules?select=match_key,category_id');
    const lookup = source.slice(source.indexOf('export function lookupCommunityRule'));
    expect(
      /restFetch|fetch\(/.test(lookup.slice(0, lookup.indexOf('\n}'))),
      'lookupCommunityRule must match against the downloaded pack, on the ' +
      'device. Asking the server per capture is the one thing this layer ' +
      'must never do.',
    ).toBe(false);
  });

  it('lets no client read what another household contributed', () => {
    // With RLS on and no SELECT policy, every client read of the contributions
    // table returns nothing. That is a property of the database, not a promise
    // about the app.
    const contributions = migration.slice(
      migration.indexOf('CREATE TABLE IF NOT EXISTS public.rule_contributions'),
      migration.indexOf('CREATE TABLE IF NOT EXISTS public.community_rules'),
    );
    expect(contributions).toContain('ENABLE ROW LEVEL SECURITY');
    expect(
      /FOR SELECT/.test(contributions),
      'rule_contributions must have NO select policy, for any role.',
    ).toBe(false);
    // Withdrawal has to be real, so deleting your own rows must be permitted.
    expect(contributions).toContain('FOR DELETE TO authenticated USING (auth.uid() = user_id)');
  });

  it('publishes a merchant only once several households agree', () => {
    expect(migration).toContain('MIN_HOUSEHOLDS constant integer := 5');
    expect(migration).toContain('MIN_AGREEMENT  constant numeric := 0.7');
    // Households, not users: a couple sharing a vault is one opinion.
    expect(migration).toContain('LEAST(c.user_id, s.partner_id)');
  });

  it('cannot be recomputed on demand by a client', () => {
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.refresh_community_rules() FROM PUBLIC');
    expect(
      /GRANT EXECUTE ON FUNCTION public\.refresh_community_rules/.test(migration),
      'A client that could time a refresh against its own contribution could ' +
      'learn something about the pool it was never shown.',
    ).toBe(false);
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { classifyMatch } from '../../../app/components/review/useVendorMatcher';
import {
  assignCaptureCategory,
  type NotificationCategoryAssignmentDependencies,
  type NotificationCategoryAssignmentInput,
  type VendorRuleRow,
} from '../../../app/lib/capture/notificationCategoryAssignment';

/**
 * The shared rule layers, and the three promises that make them safe.
 *
 * Nothing here renders or captures anything, so these are the only things in
 * the build that can notice if a borrowed rule quietly gains the authority of
 * one the user wrote themselves.
 */

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ASSIGNMENT_CATEGORIES = [
  { id: 'budget:groceries', name: 'Groceries' },
  { id: 'budget:leisure', name: 'Leisure' },
  { id: 'budget:other', name: 'Other' },
];

function makeAssignmentInput(
  overrides: Partial<NotificationCategoryAssignmentInput> = {},
): NotificationCategoryAssignmentInput {
  return {
    userId: 'user-1',
    vendor: 'Costco',
    vendorAliases: [],
    parsed: { vendorKey: 'costco', vendorDisplay: 'Costco' },
    availableCategories: ASSIGNMENT_CATEGORIES,
    ...overrides,
  };
}

function makeAssignmentDependencies(
  overrides: Partial<NotificationCategoryAssignmentDependencies> = {},
): NotificationCategoryAssignmentDependencies {
  return {
    vendorRules: Promise.resolve({ data: [] }),
    readTransactionFrequencies: async () => ({ data: [] }),
    readProperNameRule: async () => ({ data: [] }),
    fetchPartnerRules: async () => [],
    lookupCommunityRule: () => null,
    getVendorMap: () => ({}),
    ...overrides,
  };
}

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

  it('keeps a partner suggestion at zero confidence', async () => {
    const partnerRule: VendorRuleRow = {
      category_id: 'Groceries',
      proper_name: 'Costco',
      match_key: 'costco',
      match_type: 'exact',
    };
    const result = await assignCaptureCategory(
      makeAssignmentInput(),
      makeAssignmentDependencies({
        fetchPartnerRules: async () => [partnerRule],
      }),
    );

    expect(result.categoryName).toBe('Groceries');
    expect(result.overrideMatchConfidence).toBe(0);
  });

  it('does not consult borrowed rules when the user\'s own rules conflict', async () => {
    // Two of the user's own rules disagreeing means this household has not
    // settled the merchant. Answering with somebody else's opinion would be
    // worse than asking.
    const ownRules: VendorRuleRow[] = [
      { category_id: 'Groceries', proper_name: 'Costco', match_key: 'costco', match_type: 'exact' },
      { category_id: 'Leisure', proper_name: 'Costco', match_key: 'costco', match_type: 'exact' },
    ];
    let partnerReads = 0;
    const result = await assignCaptureCategory(
      makeAssignmentInput(),
      makeAssignmentDependencies({
        vendorRules: Promise.resolve({ data: ownRules }),
        fetchPartnerRules: async () => {
          partnerReads += 1;
          return [{
            category_id: 'Groceries',
            proper_name: 'Costco',
            match_key: 'costco',
            match_type: 'exact',
          }];
        },
      }),
    );

    expect(result.overrideRuleConflict).toBe(true);
    expect(result.overrideMatchConfidence).toBe(0);
    expect(partnerReads).toBe(0);
  });

  it('is never swept up by the bulk accept', async () => {
    // Bulk accept exists to ratify a screenful of the user's OWN past
    // decisions. A borrowed suggestion is not one of those, and filing a
    // screenful of them in a tap would agree to rules nobody in this household
    // had ever seen — and adopt none of them, since adoption happens on the
    // single-row accept.
    const { selectBulkAcceptable } = await import('../../../app/components/review/useVendorMatcher');
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
    const dashboard = stripComments(read('app/components/Dashboard/Dashboard.tsx'));
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
    const { lookupCommunityRule } = await import('../../../app/lib/vendors/communityRules');
    expect(lookupCommunityRule('costco')).toBeNull();
  });

  it('answers on the whole key only, never on a fragment', async () => {
    const { lookupCommunityRule } = await import('../../../app/lib/vendors/communityRules');
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
    const { lookupCommunityRule, setCommunityFlags } = await import('../../../app/lib/vendors/communityRules');
    localStorage.setItem(
      'covault_community_rules_v1',
      JSON.stringify({ fetchedAt: Date.now(), rules: [{ matchKey: 'costco', category: 'Groceries' }] }),
    );
    setCommunityFlags({ enabled: false });
    expect(lookupCommunityRule('costco')).toBeNull();
  });

  it('receives by default and sends only when asked', async () => {
    const { getCommunityFlags } = await import('../../../app/lib/vendors/communityRules');
    const flags = getCommunityFlags();
    expect(flags.enabled, 'receiving costs the user nothing and sends nothing').toBe(true);
    expect(flags.contribute, 'contributing must never be a default').toBe(false);
  });

  it('contributes nothing while the switch is off', async () => {
    const fetchSpy = vi.fn();
    vi.doMock('../../../app/lib/api/apiHelpers', () => ({ restFetch: fetchSpy }));
    const { contributeRule } = await import('../../../app/lib/vendors/communityRules');
    await contributeRule('user-1', 'costco', 'Groceries');
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.doUnmock('../../../app/lib/api/apiHelpers');
  });
});

describe('what the pool is told, and what it can be asked', () => {
  const source = read('app/lib/vendors/communityRules.ts');
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
    // The line that actually does it. Supabase's default privileges grant
    // EXECUTE on every new function to anon and authenticated, so revoking
    // from PUBLIC alone left the tally callable by any signed-in client.
    expect(migration).toContain(
      'REVOKE EXECUTE ON FUNCTION public.refresh_community_rules() FROM anon, authenticated',
    );
    expect(
      /GRANT EXECUTE ON FUNCTION public\.refresh_community_rules/.test(migration),
      'A client that could time a refresh against its own contribution could ' +
      'learn something about the pool it was never shown.',
    ).toBe(false);
  });
});

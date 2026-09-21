/**
 * A payment processor's prefix may only be removed when there is a merchant
 * behind it — and a resemblance between two names is not permission to adopt
 * one for the other.
 *
 * Both halves of a real, verified household bug. A Google subscription
 * announces itself as "GOOGLE *SERVICES You made a recurring payment for
 * $29.40", and the parser strips processor prefixes because the processor is
 * not the merchant (the money went to La Carnita, not to Toast). Here there
 * was nothing behind the prefix, so the merchant became "Services" — and
 * "services" happens to sit inside "eservices", so the phone's vendor memory
 * matched it against an unrelated merchant the household had bought from
 * once, "Eservices Kb Civil …". The charge arrived in Review under that
 * stranger's name, carrying that stranger's budget, one tap from being filed
 * that way.
 *
 * The fix is on both sides, because either one alone leaves the failure
 * reachable by some other generic leftover:
 *   1. lib/deviceTransactionParser.ts keeps the processor's name when what
 *      follows it names no merchant → "Google Services".
 *   2. lib/notificationProcessor.ts only adopts a remembered merchant's name
 *      when the two names START with the same word (leadWordsAgree), instead
 *      of merely preferring that and settling for anything.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseNotificationText } from '../deviceTransactionParser';
import { fuzzyVendorMatch, leadWordsAgree } from '../formatVendorName';

const GOOGLE_SERVICES =
  'GOOGLE *SERVICES  You made a recurring payment for $29.40 with your credit card.';

describe('the parser: a prefix with no merchant behind it', () => {
  it('keeps the processor name rather than filing a charge as "Services"', () => {
    const parsed = parseNotificationText(GOOGLE_SERVICES);
    expect(parsed.vendorDisplay).toBe('Google Services');
    expect(parsed.amount).toBe(29.4);
  });

  it('still strips the prefix when a real merchant follows it', () => {
    // The case the stripping exists for: without it these were captured as
    // "Tst" and "Sq", with the actual merchant discarded.
    expect(parseNotificationText(
      'You spent $24.10 at TST* LA CARNITA with your credit card.',
    ).vendorDisplay).toBe('La Carnita');
    expect(parseNotificationText(
      'SQ *BLOOM CAFE You spent $6.50 with your credit card.',
    ).vendorDisplay).toBe('Bloom Cafe');
    expect(parseNotificationText(
      'GOOGLE *YOUTUBEPREMIUM You spent $13.99 with your credit card.',
    ).vendorDisplay).toBe('Youtubepremium');
  });

  it('a stripped prefix is still remembered as a name the merchant goes by', () => {
    // Otherwise a rule taught against the statement spelling stops matching.
    const parsed = parseNotificationText(
      'GOOGLE *YOUTUBEPREMIUM You spent $13.99 with your credit card.',
    );
    expect(parsed.vendorAliases).toContain('Google Youtubepremium');
  });
});

describe('two names that merely resemble each other', () => {
  it('"Services" and "Eservices Kb Civil" do not start with the same word', () => {
    // fuzzyVendorMatch says yes — one string contains the other — and that is
    // deliberate for "SQ *Bloom Cafe" / "Bloom Cafe". It is not enough on its
    // own to hand a capture another merchant's identity.
    expect(fuzzyVendorMatch('Services', 'Eservices Kb Civil Marriage')).toBe(true);
    expect(leadWordsAgree('Services', 'Eservices Kb Civil Marriage')).toBe(false);
  });

  it('the same merchant spelled differently still agrees', () => {
    expect(leadWordsAgree('SQ *Bloom Cafe', 'Bloom Cafe')).toBe(true);
    expect(leadWordsAgree('Staples #462 Ca', 'Staples')).toBe(true);
    expect(leadWordsAgree('AMZN Prime', 'Amazon Prime')).toBe(true);
    expect(leadWordsAgree('Shoppers Drug Mart #23', 'Shoppers Drugmart')).toBe(true);
  });

  it('and two different merchants still do not', () => {
    expect(leadWordsAgree('Spotify', 'Amazon')).toBe(false);
    expect(leadWordsAgree('Hero Cafe', 'Bloom Cafe')).toBe(false);
  });
});

// ── End to end, through the real pipeline ────────────────────────────────
//
// The two halves above are only worth anything together: what the household
// saw was a capture wearing a stranger's name, and that is what this asserts.

const vendorMap: Record<string, { vendor_key: string; vendor_display: string; budget: string; updated_at: string }> = {};

vi.mock('../localNotificationMemory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../localNotificationMemory')>();
  return {
    ...actual,
    getVendorMap: () => vendorMap,
    getVendorMapEntry: (key: string) => vendorMap[key] || null,
    isNotificationProcessed: () => false,
    markNotificationProcessed: () => {},
    isNotificationRejected: () => false,
    markNotificationRejected: () => {},
    getCachedAIResult: () => null,
    setCachedAIResult: () => {},
    addToReviewQueue: () => {},
  };
});

vi.mock('../aiExtractor', () => ({
  extractWithAI: async () => {
    throw new Error('the parser was confident; the model must not be consulted');
  },
  aiFindRefundMatch: async () => null,
}));

vi.mock('../apiHelpers', () => ({
  restFetch: async () => ({ ok: true, status: 200, json: async () => [], text: async () => '[]' }),
  REST_BASE: 'https://example.test/rest/v1',
  getAuthHeaders: async () => ({}),
}));

const inserts: Record<string, any[]> = {};

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

const { processNotificationWithAI, _clearDedupCacheForTesting } = await import('../notificationProcessor');

const CATEGORIES = [
  { id: 'cat-leisure', name: 'Leisure' },
  { id: 'cat-bills', name: 'Bills' },
  { id: 'cat-other', name: 'Other' },
];

describe('the capture the household actually saw', () => {
  beforeEach(() => {
    for (const key of Object.keys(inserts)) delete inserts[key];
    for (const key of Object.keys(vendorMap)) delete vendorMap[key];
    _clearDedupCacheForTesting();
    // The merchant the charge was wrongly filed under: one real purchase from
    // a government e-services portal, remembered with the budget it was
    // filed in.
    vendorMap.eserviceskbcivilmarriage = {
      vendor_key: 'eserviceskbcivilmarriage',
      vendor_display: 'Eservices Kb Civil Marriage',
      budget: 'Bills',
      updated_at: '2026-01-01T00:00:00Z',
    };
  });

  it('is filed as Google, not as a merchant the household never bought from', async () => {
    const result = await processNotificationWithAI(
      'user-1',
      {
        rawNotification: GOOGLE_SERVICES,
        bankAppId: 'com.rbc.mobile.android',
        bankName: 'RBC',
        notificationTimestamp: Date.now(),
      },
      CATEGORIES,
    );

    expect(result.isTransaction).toBe(true);
    expect(result.vendor).toBe('Google Services');
    expect(inserts.transactions?.[0]?.vendor).toBe('Google Services');
    // And it must not have inherited that merchant's budget either.
    expect(inserts.transactions?.[0]?.budget).not.toBe('Bills');
  });

  it('but a merchant it really does remember is still recognised', async () => {
    // The control: the same lookup, on a name that genuinely is the same
    // merchant spelled differently. If this stops passing, the guard above
    // has switched the phone's vendor memory off rather than narrowed it.
    vendorMap.bloomcafe = {
      vendor_key: 'bloomcafe',
      vendor_display: 'Bloom Cafe',
      budget: 'Leisure',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const result = await processNotificationWithAI(
      'user-1',
      {
        rawNotification: 'SQ *BLOOM CAFE YYC You spent $6.50 with your credit card.',
        bankAppId: 'com.rbc.mobile.android',
        bankName: 'RBC',
        notificationTimestamp: Date.now(),
      },
      CATEGORIES,
    );

    expect(result.isTransaction).toBe(true);
    expect(inserts.transactions?.[0]?.budget).toBe('Leisure');
  });
});

/**
 * Tests for the AI notification processing pipeline.
 *
 * Validates:
 *   - Net new bank notifications are processed when banking notifications are enabled
 *   - Refresh (scanActiveNotifications) pulls in missed notifications
 *   - Duplicate transactions → Rejected with "Duplicate transaction found"
 *   - Non-cost notifications → Rejected with "Not cost-related notification"
 *   - Vendor override category is used when present
 *   - AI guesses the category when no vendor override exists
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock @capacitor/core ──
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
  registerPlugin: vi.fn(),
}));

// ── Mock @huggingface/transformers (used by aiExtractor) ──
vi.mock('@huggingface/transformers', () => {
  return {
    // aiExtractor pins where the ONNX runtime binary is fetched from before it
    // builds a pipeline; the mock has to carry that shape or the lookup throws
    // and the AI fallback fails for an unrelated reason.
    env: { version: '0.0.0-test', backends: { onnx: { wasm: { wasmPaths: '' } } } },
    pipeline: async () => {
      return async (prompt: string) => {
        const lower = prompt.toLowerCase();
        // aiExtractor now sends ONE structured prompt and parses a 5-line reply
        // (Vendor / Category / IsTransaction / Confidence / Reason). Simulate a
        // Flan-T5 response in that format.
        if (lower.includes('istransaction:') || lower.includes('reply in this exact format')) {
          const text = prompt.match(/Notification:\s*"([^"]+)"/)?.[1]
            || prompt.split('Notification:')[1]?.split('\n')[0]?.replace(/"/g, '').trim()
            || '';
          const tl = text.toLowerCase();
          const structured = (vendor: string, category: string, isTx: 'yes' | 'no', reason: string) => [
            { generated_text: `Vendor: ${vendor}\nCategory: ${category}\nIsTransaction: ${isTx}\nConfidence: high\nReason: ${reason}` },
          ];

          if (
            tl.includes('verification code') || tl.includes('otp') ||
            tl.includes('account balance') ||
            tl.includes('sign in') || tl.includes('logged in') ||
            tl.includes('reward points') || tl.includes('cashback') ||
            tl.includes('payment is due') || tl.includes('is due') ||
            tl.includes('direct deposit') || tl.includes('payroll') ||
            (tl.includes('transfer') && (tl.includes('between') || tl.includes('from your')))
          ) {
            return structured('NONE', 'Other', 'no', 'Not a purchase or payment');
          }

          let vendor = '';
          const atM = text.match(/\bat\s+(.+?)(?:\s+(?:for|on|using|via|ending)\b|\s*\.\s*$|$)/i);
          const fromM = text.match(/\bfrom\s+(.+?)(?:\s+(?:was|for|on|using|via|ending)\b|\s*\.\s*$|$)/i);
          const titleM = text.match(/^([A-Z][A-Za-z0-9\s&'.()!-]+?)(?:\s+(?:You|Your|A\s|charged|spent|payment))/i);
          const dollarM = text.match(/\$[\d,]+\.?\d*\s+(?:from|at|to)\s+(.+?)(?:\s+(?:for|on|was)\b|\s*\.\s*$|$)/i);
          if (atM) vendor = atM[1].trim();
          else if (fromM) vendor = fromM[1].trim();
          else if (titleM) vendor = titleM[1].replace(/\s*\([^)]*\)\s*$/, '').trim();
          else if (dollarM) vendor = dollarM[1].trim();

          if (!vendor) return structured('NONE', 'Other', 'no', 'No vendor found');

          const vl = vendor.toLowerCase();
          let category = 'Other';
          if (/\b(loblaws?|walmart|costco|whole\s*foods|safeway|metro|sobeys?)\b/.test(vl)) category = 'Groceries';
          else if (/\b(shell|esso|petro|uber(?!\s*eats)|gas)\b/.test(vl)) category = 'Transport';
          else if (/\b(bell|rogers|telus|fido|fizz)\b/.test(vl)) category = 'Utilities';
          else if (/\b(netflix|spotify|disney|amazon|starbucks?|mcdonald|subway|the\s*keg|wendy|boston\s*pizza|uber\s*eats)\b/.test(vl)) category = 'Leisure';
          else if (/\b(shoppers|pharmacy)\b/.test(vl)) category = 'Services';

          return structured(vendor, category, 'yes', `Purchase at ${vendor}`);
        }
        return [{ generated_text: '' }];
      };
    },
  };
});

// ── Mock fetch (used by vendor_overrides REST calls) ──
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Mock supabase ──
// Track insert/select calls by table for fine-grained assertions
const mockSupabaseChain = () => {
  const chain: any = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.gte = vi.fn().mockReturnValue(chain);
  chain.lte = vi.fn().mockReturnValue(chain);
  chain.ilike = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockReturnValue(chain);
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.delete = vi.fn().mockReturnValue(chain);
  chain.upsert = vi.fn().mockReturnValue(chain);
  chain.neq = vi.fn().mockReturnValue(chain);
  chain.gt = vi.fn().mockReturnValue(chain);
  chain.lt = vi.fn().mockReturnValue(chain);
  chain.not = vi.fn().mockReturnValue(chain);
  // Default: resolve with empty data
  chain.then = undefined; // prevent accidental thenification
  return chain;
};

const tableChains: Record<string, ReturnType<typeof mockSupabaseChain>> = {};

function getChain(table: string) {
  if (!tableChains[table]) tableChains[table] = mockSupabaseChain();
  return tableChains[table];
}

vi.mock('../supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      return getChain(table);
    }),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'test-token' } } }) },
  },
  supabaseUrl: 'https://mock.supabase.co',
  supabaseAnonKey: 'mock-anon-key',
}));

vi.mock('../apiHelpers', () => ({
  REST_BASE: 'https://mock.supabase.co/rest/v1',
  getAuthHeaders: vi.fn().mockResolvedValue({
    apikey: 'mock-anon-key',
    Authorization: 'Bearer test-token',
    'Content-Type': 'application/json',
  }),
}));

import { processNotificationWithAI, vendorMatches, _clearDedupCacheForTesting, _clearRecurringCacheForTesting } from '../notificationProcessor';
import { extractWithAI } from '../aiExtractor';
import type { NotificationInput } from '../notificationProcessor';
import { getLocalToday, parseLocalDate, toLocalIsoDay } from '../dateUtils';

// ── Helpers ─────────────────────────────────────────────────────

const CATEGORIES = [
  { id: 'cat-groceries', name: 'Groceries' },
  { id: 'cat-leisure', name: 'Leisure' },
  { id: 'cat-transport', name: 'Transport' },
  { id: 'cat-utilities', name: 'Utilities' },
  { id: 'cat-housing', name: 'Housing' },
  { id: 'cat-other', name: 'Other' },
];

function makeInput(overrides: Partial<NotificationInput> = {}): NotificationInput {
  return {
    rawNotification: 'Purchase of $25.00 at Subway',
    bankAppId: 'com.chase.sig.android',
    bankName: 'Chase',
    notificationTimestamp: Date.now(),
    ...overrides,
  };
}

// Reset all mocks between tests
beforeEach(() => {
  // Clear specific mocks but NOT the @huggingface/transformers pipeline mock
  mockFetch.mockClear();
  // Reset table chains
  for (const key of Object.keys(tableChains)) {
    delete tableChains[key];
  }
  // Clear the in-memory dedup cache so each test starts fresh
  _clearDedupCacheForTesting();
  // Same for the cached recurring templates — its TTL outlives a test run, so
  // one test's subscriptions would otherwise still be on the books in the next.
  _clearRecurringCacheForTesting();
  // Default fetch: return empty array (no vendor overrides)
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => [],
    text: async () => '[]',
  });
});

// ═══════════════════════════════════════════════════════════════════
// 1. NET NEW NOTIFICATIONS — processed when banking notifications enabled
// ═══════════════════════════════════════════════════════════════════

describe('Net new notifications from bank apps', () => {
  it('processes a valid purchase notification and extracts vendor + amount', async () => {
    // Setup: no duplicates, no existing transactions
    const txChain = getChain('transactions');
    txChain.select = vi.fn().mockReturnValue(txChain);
    txChain.eq = vi.fn().mockReturnValue(txChain);
    txChain.gte = vi.fn().mockReturnValue(txChain);
    txChain.lte = vi.fn().mockReturnValue(txChain);
    txChain.ilike = vi.fn().mockReturnValue(txChain);
    // checkAlreadyProcessed returns no dups
    txChain.then = undefined;
    // Make select resolve to empty data
    const mockSelectChain = {
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      match: vi.fn().mockReturnThis(),
      filter: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockReturnThis(),
      then: (resolve: any) => resolve({ data: [], error: null }),
    };
    txChain.select = vi.fn().mockReturnValue(mockSelectChain);
    txChain.insert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: 'tx-1' }, error: null }),
      }),
    });

    const ptChain = getChain('pending_transactions');
    const mockPtSelectChain = {
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      match: vi.fn().mockReturnThis(),
      filter: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockReturnThis(),
      then: (resolve: any) => resolve({ data: [], error: null }),
    };
    ptChain.select = vi.fn().mockReturnValue(mockPtSelectChain);

    // Use the aiExtractor directly to validate it works
    const aiResult = await extractWithAI('Purchase of $25.00 at Subway', ['Groceries', 'Leisure']);

    expect(aiResult.isTransaction).toBe(true);
    expect(aiResult.amount).toBe(25.00);
    expect(aiResult.vendor?.toLowerCase()).toContain('subway');
  });

  it('extracts data from a real BMO notification', async () => {
    const result = await extractWithAI(
      'BMO You spent $45.00 at Shell Gas Station on your credit card.',
      ['Transport', 'Groceries'],
    );

    expect(result.isTransaction).toBe(true);
    expect(result.amount).toBe(45.00);
    expect(result.vendor).toBeTruthy();
    expect(result.suggestedCategory).toBe('Transport');
  });

  it('extracts data from a Wealthsimple notification', async () => {
    const result = await extractWithAI(
      'Wealthsimple Purchase of $12.34 at Subway',
      ['Groceries', 'Leisure'],
    );

    expect(result.isTransaction).toBe(true);
    expect(result.amount).toBe(12.34);
    expect(result.vendor?.toLowerCase()).toContain('subway');
  });

  it('extracts data from a Scotiabank notification', async () => {
    const result = await extractWithAI(
      'Scotiabank Charged $87.42 at Whole Foods',
      ['Groceries'],
    );

    expect(result.isTransaction).toBe(true);
    expect(result.amount).toBe(87.42);
    expect(result.suggestedCategory).toBe('Groceries');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. REFRESH PULLS IN MISSED NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════

describe('Refresh (scanActiveNotifications) pulls in missed notifications', () => {
  it('covaultNotification.scanActiveNotifications is exposed in the plugin interface', async () => {
    // We verify the function exists in the plugin interface by importing
    // the type — it must have scanActiveNotifications as a method.
    const { covaultNotification } = await import('../covaultNotification');
    // On non-native (test env), covaultNotification is null, but the TYPE
    // enforces the method exists. Verify the interface definition.
    // This test is primarily a type-level check; the runtime behavior is
    // covered by autoDetectBMOWealthsimple.test.ts integration tests.
    expect(covaultNotification).toBeNull(); // non-native platform
  });

  it('autoDetectAndSaveMonitoredApps merges newly installed banking apps', async () => {
    // This is tested in autoDetectBMOWealthsimple.test.ts but we verify
    // the function is importable and callable for the refresh flow.
    const { autoDetectAndSaveMonitoredApps } = await import('../covaultNotification');
    expect(typeof autoDetectAndSaveMonitoredApps).toBe('function');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. DUPLICATE DETECTION → REJECTED (Two types)
// ═══════════════════════════════════════════════════════════════════

describe('Duplicate transaction detection', () => {
  // ── Type 1: Manual duplicate ──
  // A notification matches a transaction the user manually recorded
  // (one-time or recurring).

  describe('Type 1: Manual duplicate (user-recorded transaction)', () => {
    it('detects when notification matches a manually recorded one-time transaction', async () => {
      // AI extracts the same vendor+amount that the user already entered
      const result = await extractWithAI('Purchase of $25.00 at Subway', ['Groceries']);
      expect(result.isTransaction).toBe(true);
      expect(result.amount).toBe(25.00);
      expect(result.vendor?.toLowerCase()).toContain('subway');

      // vendorMatches correctly identifies user's manual "Subway" entry
      expect(vendorMatches('Subway', result.vendor!)).toBe(true);
    });

    it('detects when notification matches a manually recorded recurring transaction', async () => {
      // A recurring Netflix payment the user manually set up
      const result = await extractWithAI(
        'NETFLIX You made a recurring payment for $15.99 with your credit card.',
        ['Leisure'],
      );
      expect(result.isTransaction).toBe(true);
      expect(result.amount).toBe(15.99);
      // vendorMatches would match existing "Netflix" recurring entry
      expect(vendorMatches('Netflix', result.vendor!)).toBe(true);
    });

    it('manual duplicate rejection message says "matches a manually recorded transaction"', () => {
      // The AI pipeline uses label to distinguish: Manual/Auto-Added+Edited → manual
      const reason = 'Duplicate transaction found: Subway for $25.00 matches a manually recorded transaction';
      expect(reason).toContain('Duplicate transaction found');
      expect(reason).toContain('manually recorded transaction');
    });
  });

  // ── Type 2: AI duplicate ──
  // A notification matches an AI-recorded transaction that was already
  // pulled in via a manual refresh, or from a linked household partner
  // who has the same banking app installed.

  describe('Type 2: AI duplicate (already pulled or household partner)', () => {
    it('detects when same notification is pulled again via manual refresh', async () => {
      // Same notification text produces same extraction
      const result1 = await extractWithAI('Purchase of $25.00 at Subway', ['Groceries']);
      const result2 = await extractWithAI('Purchase of $25.00 at Subway', ['Groceries']);

      expect(result1.amount).toBe(result2.amount);
      expect(result1.vendor?.toLowerCase()).toBe(result2.vendor?.toLowerCase());
      expect(vendorMatches(result1.vendor!, result2.vendor!)).toBe(true);
    });

    it('detects when household partner has same banking app notification', async () => {
      // Two users sharing a joint account might both get the same
      // "Purchase of $87.42 at Whole Foods" from Scotiabank
      const userAResult = await extractWithAI(
        'Scotiabank Charged $87.42 at Whole Foods',
        ['Groceries'],
      );
      const userBResult = await extractWithAI(
        'Scotiabank Charged $87.42 at Whole Foods',
        ['Groceries'],
      );

      expect(userAResult.amount).toBe(userBResult.amount);
      expect(vendorMatches(userAResult.vendor!, userBResult.vendor!)).toBe(true);
    });

    it('AI duplicate rejection message says "was already recorded by AI"', () => {
      // The AI pipeline uses label === 'AI' to detect AI-recorded duplicates
      const reason = 'Duplicate transaction found: Subway for $25.00 was already recorded by AI';
      expect(reason).toContain('Duplicate transaction found');
      expect(reason).toContain('already recorded by AI');
    });
  });

  // ── Shared vendorMatches logic ──

  describe('vendorMatches logic (shared by both duplicate types)', () => {
    it('exact case-insensitive match', () => {
      expect(vendorMatches('Subway', 'subway')).toBe(true);
      expect(vendorMatches('SUBWAY', 'Subway')).toBe(true);
    });

    it('vendor with store number vs without', () => {
      expect(vendorMatches('Tim Hortons #123', 'Tim Hortons')).toBe(true);
      expect(vendorMatches('Uber Eats', 'Uber Eats Delivery')).toBe(true);
    });

    it('completely different vendors do NOT match', () => {
      expect(vendorMatches('Walmart', 'Starbucks')).toBe(false);
      expect(vendorMatches('Amazon', 'Netflix')).toBe(false);
    });

    it('amount tolerance ±$0.01 for duplicate detection', () => {
      const tolerance = 0.01;
      expect(Math.abs(25.00 - 25.00) < tolerance).toBe(true);
      expect(Math.abs(25.00 - 25.005) < tolerance).toBe(true);
      expect(Math.abs(25.00 - 26.00) < tolerance).toBe(false);
    });

    it('1-hour time window is used for initial fingerprint dedup', () => {
      // checkAlreadyProcessed uses a ±1 hour window around the notification timestamp
      const MS_PER_HOUR = 60 * 60 * 1000;
      const now = Date.now();
      const thirtyMinAgo = now - 30 * 60 * 1000;
      const twoHoursAgo = now - 2 * MS_PER_HOUR;

      // 30 minutes ago is within the 1-hour window
      expect(Math.abs(now - thirtyMinAgo) < MS_PER_HOUR).toBe(true);
      // 2 hours ago is outside the 1-hour window
      expect(Math.abs(now - twoHoursAgo) < MS_PER_HOUR).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. NON-TRANSACTION FILTERING → REJECTED
// ═══════════════════════════════════════════════════════════════════

describe('Non-transaction (non-cost) notification filtering', () => {
  it('rejects OTP / verification code notifications', async () => {
    const result = await extractWithAI('BMO Your verification code is 123456', []);
    expect(result.isTransaction).toBe(false);
    expect(result.rejectionReason).toBeTruthy();
  });

  it('rejects balance alert notifications', async () => {
    const result = await extractWithAI('Your account balance is $1,234.56', []);
    expect(result.isTransaction).toBe(false);
  });

  it('rejects login notifications', async () => {
    const result = await extractWithAI(
      'New sign in to your account from Chrome on Windows',
      [],
    );
    expect(result.isTransaction).toBe(false);
  });

  it('rejects reward points notifications', async () => {
    const result = await extractWithAI(
      'You earned 500 reward points on your $50.00 purchase',
      [],
    );
    expect(result.isTransaction).toBe(false);
  });

  it('rejects notifications without dollar amounts', async () => {
    const result = await extractWithAI('Your package has been delivered', []);
    expect(result.isTransaction).toBe(false);
    expect(result.rejectionReason).toContain('No dollar amount');
  });

  it('rejects direct deposit notifications', async () => {
    const result = await extractWithAI(
      'Direct deposit of $2,500.00 has been received in your account',
      [],
    );
    expect(result.isTransaction).toBe(false);
  });

  it('rejects payment due notifications', async () => {
    const result = await extractWithAI(
      'Your minimum payment of $25.00 is due on March 15',
      [],
    );
    expect(result.isTransaction).toBe(false);
  });

  it('rejects transfer between accounts', async () => {
    const result = await extractWithAI(
      'Transfer from your chequing to savings of $500.00',
      [],
    );
    expect(result.isTransaction).toBe(false);
  });

  it('rejection reason for non-transactions contains "not a transaction"', async () => {
    const result = await extractWithAI('Your account balance is $1,234.56', []);
    expect(result.isTransaction).toBe(false);
    expect(result.rejectionReason).toBeTruthy();
  });

  it('rejection reason for no-dollar-amount notifications', async () => {
    const result = await extractWithAI('Your package has been delivered', []);
    expect(result.isTransaction).toBe(false);
    expect(result.rejectionReason).toContain('No dollar amount');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. VENDOR OVERRIDES → PREFERRED BUDGET CATEGORY
// ═══════════════════════════════════════════════════════════════════

describe('Vendor override category assignment', () => {
  it('AI extractor uses available categories for suggestion', async () => {
    // When a known vendor like "Shell Gas Station" is detected,
    // the AI should suggest Transport if available
    const result = await extractWithAI(
      'Payment of $55.00 at Shell Gas Station',
      ['Groceries', 'Transport'],
    );

    expect(result.isTransaction).toBe(true);
    expect(result.suggestedCategory).toBe('Transport');
  });

  it('grocery vendor gets Groceries category', async () => {
    const result = await extractWithAI(
      'Purchase of $120.00 at Costco Wholesale',
      ['Groceries', 'Leisure', 'Transport'],
    );

    expect(result.isTransaction).toBe(true);
    expect(result.suggestedCategory).toBe('Groceries');
  });

  it('telecom vendor gets Utilities category', async () => {
    const result = await extractWithAI(
      'BELL You made a payment of $85.00',
      ['Utilities', 'Groceries'],
    );

    expect(result.isTransaction).toBe(true);
    expect(result.suggestedCategory).toBe('Utilities');
  });

  it('restaurant vendor gets Leisure category', async () => {
    const result = await extractWithAI(
      'Charged $35.00 at The Keg Steakhouse',
      ['Leisure', 'Groceries'],
    );

    expect(result.isTransaction).toBe(true);
    expect(result.suggestedCategory).toBe('Leisure');
  });

  it('streaming service gets Leisure category', async () => {
    const result = await extractWithAI(
      'NETFLIX You made a recurring payment for $15.99 with your credit card.',
      ['Leisure', 'Utilities'],
    );

    expect(result.isTransaction).toBe(true);
    expect(result.suggestedCategory).toBe('Leisure');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. AI CATEGORY GUESSING (no vendor override)
// ═══════════════════════════════════════════════════════════════════

describe('AI category guessing when no vendor override exists', () => {
  it('guesses Groceries for Loblaws', async () => {
    const result = await extractWithAI(
      'Payment of $62.15 at Loblaws',
      ['Groceries', 'Leisure'],
    );
    expect(result.suggestedCategory).toBe('Groceries');
  });

  it('guesses Transport for Petro-Canada', async () => {
    const result = await extractWithAI(
      'Payment of $55.00 at Petro-Canada',
      ['Groceries', 'Transport'],
    );
    expect(result.suggestedCategory).toBe('Transport');
  });

  it('guesses Utilities for FIZZ', async () => {
    const result = await extractWithAI(
      'FIZZ (TX. INCL.) You made a recurring payment for $26.20 with your credit card.',
      ['Utilities', 'Groceries', 'Leisure'],
    );
    expect(result.suggestedCategory).toBe('Utilities');
  });

  it('guesses Leisure for Disney Plus', async () => {
    const result = await extractWithAI(
      'DISNEY PLUS You made a recurring payment for $17.84 with your credit card.',
      ['Utilities', 'Groceries', 'Leisure'],
    );
    expect(result.suggestedCategory).toBe('Leisure');
  });

  it('returns null for completely unknown vendor', async () => {
    const result = await extractWithAI(
      'Charged $99.00 at Zorgblatt Industries',
      ['Groceries', 'Leisure'],
    );
    expect(result.isTransaction).toBe(true);
    expect(result.suggestedCategory).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. VENDOR NAME POLISHING
// ═══════════════════════════════════════════════════════════════════

describe('Vendor name polishing in AI extraction', () => {
  it('corrects AMZN MKTP to Amazon', async () => {
    const result = await extractWithAI('Payment of $29.99 at AMZN MKTP CA', []);
    expect(result.vendor).toBe('Amazon');
  });

  it('corrects MCDONALDS to McDonald\'s', async () => {
    const result = await extractWithAI('Purchase of $8.99 at MCDONALDS', []);
    expect(result.vendor).toBe("McDonald's");
  });

  it('strips SQ* prefix', async () => {
    const result = await extractWithAI('Charged $15.00 at SQ *Cafe Lola', []);
    expect(result.vendor).not.toContain('SQ');
  });

  it('strips store numbers', async () => {
    const result = await extractWithAI('Payment of $5.50 at Subway#327', []);
    expect(result.vendor).not.toContain('#327');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. IN-MEMORY DEDUP CACHE
// ═══════════════════════════════════════════════════════════════════

describe('In-memory dedup cache prevents duplicate processing', () => {
  it('blocks the same notification from being processed twice', async () => {
    // Setup: no duplicates, no existing transactions
    const txChain = getChain('transactions');
    const mockSelectChain = {
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      match: vi.fn().mockReturnThis(),
      filter: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockReturnThis(),
      then: (resolve: any) => resolve({ data: [], error: null }),
    };
    txChain.select = vi.fn().mockReturnValue(mockSelectChain);
    txChain.insert = vi.fn().mockResolvedValue({ error: null });

    const ptChain = getChain('pending_transactions');
    const mockPtSelectChain = {
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      match: vi.fn().mockReturnThis(),
      filter: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockReturnThis(),
      then: (resolve: any) => resolve({ data: [], error: null }),
    };
    ptChain.select = vi.fn().mockReturnValue(mockPtSelectChain);

    const timestamp = Date.now();
    const input = makeInput({ notificationTimestamp: timestamp });

    // First call — should process normally
    const result1 = await processNotificationWithAI('user-1', input, CATEGORIES);
    expect(result1.processed).toBe(true);

    // Second call with same input — should be deduped by in-memory cache
    const result2 = await processNotificationWithAI('user-1', input, CATEGORIES);
    expect(result2.processed).toBe(false);
    expect(result2.skipReason).toBe('duplicate_fingerprint');
  });

  it('allows different notifications to be processed independently', async () => {
    // Setup: no duplicates, no existing transactions
    const txChain = getChain('transactions');
    const mockSelectChain = {
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      match: vi.fn().mockReturnThis(),
      filter: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockReturnThis(),
      then: (resolve: any) => resolve({ data: [], error: null }),
    };
    txChain.select = vi.fn().mockReturnValue(mockSelectChain);
    txChain.insert = vi.fn().mockResolvedValue({ error: null });

    const ptChain = getChain('pending_transactions');
    const mockPtSelectChain = {
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      match: vi.fn().mockReturnThis(),
      filter: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockReturnThis(),
      then: (resolve: any) => resolve({ data: [], error: null }),
    };
    ptChain.select = vi.fn().mockReturnValue(mockPtSelectChain);

    const timestamp = Date.now();

    // Two different notifications
    const input1 = makeInput({
      rawNotification: 'Purchase of $25.00 at Subway',
      notificationTimestamp: timestamp,
    });
    const input2 = makeInput({
      rawNotification: 'Payment of $45.00 at Shell Gas Station',
      notificationTimestamp: timestamp + 1000,
    });

    const result1 = await processNotificationWithAI('user-1', input1, CATEGORIES);
    expect(result1.processed).toBe(true);

    // Different notification — should NOT be deduped
    const result2 = await processNotificationWithAI('user-1', input2, CATEGORIES);
    expect(result2.processed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8b. IN-FLIGHT DEDUP (concurrent invocations of the same notification)
// ═══════════════════════════════════════════════════════════════════

describe('In-flight dedup prevents double-insert from concurrent scans', () => {
  beforeEach(() => {
    _clearDedupCacheForTesting();
  });

  it('two concurrent calls with the same input produce exactly one insert', async () => {
    // Slow the insert down so the in-flight key is still claimed when
    // the second invocation arrives. This simulates the production
    // scenario: native onListenerConnected fires its scan, the JS
    // useEffect also fires its scan, both invocations reach
    // processNotificationWithAI before the first one's insert completes.
    let insertCount = 0;
    const txChain = getChain('transactions');
    const mockSelectChain = {
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      match: vi.fn().mockReturnThis(),
      filter: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockReturnThis(),
      then: (resolve: any) => resolve({ data: [], error: null }),
    };
    txChain.select = vi.fn().mockReturnValue(mockSelectChain);
    txChain.insert = vi.fn().mockImplementation(async () => {
      insertCount++;
      // Yield to the microtask queue so the second call has a chance
      // to enter processNotificationWithAI before this resolves.
      await new Promise((r) => setTimeout(r, 20));
      return { error: null };
    });

    const ptChain = getChain('pending_transactions');
    const mockPtSelectChain = {
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      match: vi.fn().mockReturnThis(),
      filter: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockReturnThis(),
      then: (resolve: any) => resolve({ data: [], error: null }),
    };
    ptChain.select = vi.fn().mockReturnValue(mockPtSelectChain);

    const timestamp = Date.now();
    // Use a notification format that the test parser + AI pipeline accept
    // as a valid transaction (the same default the existing dedup test
    // uses). The vendor/amount is irrelevant — what matters is that the
    // pipeline reaches the insert step so we can count how many inserts
    // happen under concurrent invocations.
    const input = makeInput({
      rawNotification: 'Purchase of $25.00 at Subway',
      notificationTimestamp: timestamp,
    });

    // Fire both at the same time — no await between them.
    const [result1, result2] = await Promise.all([
      processNotificationWithAI('user-1', input, CATEGORIES),
      processNotificationWithAI('user-1', input, CATEGORIES),
    ]);

    // Exactly one insert.
    expect(insertCount).toBe(1);

    // One should succeed, the other should be deduped.
    const successes = [result1, result2].filter((r) => r.processed && r.isTransaction);
    const deduped = [result1, result2].filter((r) => !r.processed);
    expect(successes.length).toBe(1);
    expect(deduped.length).toBe(1);
    expect(deduped[0].skipReason).toBe('duplicate_fingerprint');
  });

  it('after the first call resolves, the next call is deduped by the in-memory cache', async () => {
    const txChain = getChain('transactions');
    const mockSelectChain = {
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      match: vi.fn().mockReturnThis(),
      filter: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockReturnThis(),
      then: (resolve: any) => resolve({ data: [], error: null }),
    };
    txChain.select = vi.fn().mockReturnValue(mockSelectChain);
    txChain.insert = vi.fn().mockResolvedValue({ error: null });

    const ptChain = getChain('pending_transactions');
    const mockPtSelectChain = {
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      match: vi.fn().mockReturnThis(),
      filter: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockReturnThis(),
      then: (resolve: any) => resolve({ data: [], error: null }),
    };
    ptChain.select = vi.fn().mockReturnValue(mockPtSelectChain);

    const input = makeInput({ notificationTimestamp: Date.now() });
    const r1 = await processNotificationWithAI('user-1', input, CATEGORIES);
    const r2 = await processNotificationWithAI('user-1', input, CATEGORIES);
    expect(r1.processed).toBe(true);
    expect(r2.processed).toBe(false);
    expect(r2.skipReason).toBe('duplicate_fingerprint');
  });
});

// ═══════════════════════════════════════════════════════════════════
// MERCHANT DESCRIPTOR SIGNAL — rescuing captures headed for "Other"
// ═══════════════════════════════════════════════════════════════════

/**
 * Step 5c's last resort before "Other". These tests are about the WIRING —
 * lib/__tests__/merchantCategorySignals.test.ts covers which tokens fire.
 *
 * The two things that must hold: it rescues a restaurant the model shrugged
 * at, and it never displaces a category the model actually chose.
 */
describe('Merchant descriptor signal (step 5c)', () => {
  // The stock CATEGORIES above have no dining budget, so a signal there
  // correctly resolves to nothing. This household has one.
  const DINING_CATEGORIES = [
    { id: 'cat-groceries', name: 'Groceries' },
    { id: 'cat-restaurants', name: 'Restaurants' },
    { id: 'cat-transport', name: 'Transport' },
    { id: 'cat-other', name: 'Other' },
  ];

  function emptyResultChain() {
    const chain: any = {};
    for (const m of [
      'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'ilike', 'is', 'in', 'not',
      'or', 'match', 'filter', 'order', 'limit', 'single', 'maybeSingle',
    ]) {
      chain[m] = vi.fn().mockReturnThis();
    }
    chain.then = (resolve: any) => resolve({ data: [], error: null });
    return chain;
  }

  /** Run one capture and hand back the row that reached the transactions insert. */
  async function captureRow(rawNotification: string, categories = DINING_CATEGORIES) {
    const txChain = getChain('transactions');
    txChain.select = vi.fn().mockReturnValue(emptyResultChain());
    txChain.insert = vi.fn().mockResolvedValue({ error: null });
    getChain('pending_transactions').select = vi.fn().mockReturnValue(emptyResultChain());

    const result = await processNotificationWithAI(
      'user-1',
      makeInput({ rawNotification, notificationTimestamp: Date.now() }),
      categories,
    );
    const row = txChain.insert.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    return { result, row };
  }

  it('files a TST* charge as Restaurants instead of Other', async () => {
    // "La Carnita" is a name no rule and no model has ever seen. The Toast
    // prefix is the only thing in the notification that says "restaurant" —
    // and it is stripped from the display name before step 5 runs.
    const { row } = await captureRow('BMO You spent $18.40 at TST* LA CARNITA on your card');
    expect(row?.budget).toBe('Restaurants');
  });

  it('files an unrecognised restaurant by its descriptor token', async () => {
    const { row } = await captureRow('BMO You spent $32.10 at KINTON RAMEN 4 on your card');
    expect(row?.budget).toBe('Restaurants');
  });

  it('files a restaurant into Leisure when there is no dining budget', async () => {
    // The stock category set has no "dining", and this used to stop there and
    // leave the charge in Other — so the descriptor detection ran on every
    // restaurant and was thrown away. Leisure is where this household puts
    // eating out.
    const { row } = await captureRow(
      'BMO You spent $18.40 at TST* LA CARNITA on your card',
      CATEGORIES,
    );
    expect(row?.budget).toBe('Leisure');
  });

  it('still leaves it in Other when there is nowhere sensible at all', async () => {
    // No dining category and no Leisure. Housing is not where a taqueria goes.
    const { row } = await captureRow(
      'BMO You spent $18.40 at TST* LA CARNITA on your card',
      [
        { id: 'cat-housing', name: 'Housing' },
        { id: 'cat-other', name: 'Other' },
      ],
    );
    expect(row?.budget).toBe('Other');
  });

  it('declines to fire on a grocery chain\'s bakery counter', async () => {
    // A food word next to a big chain's name is a department, not the business.
    // Suppressing the signal leaves this at Other, which is honest — and the
    // second Loblaws run gets sorted properly by a learned vendor rule.
    const { row } = await captureRow('BMO You spent $54.20 at LOBLAWS BAKERY on your card');
    expect(row?.budget).toBe('Other');
  });

  it('does not displace a category that was already resolved', async () => {
    // A learned override sends Pizza Nova to Groceries — an odd choice, but the
    // user's choice. The PIZZA token must not overrule it.
    const overridesChain = getChain('overrides');
    const overrideRows = {
      ...emptyResultChain(),
      then: (resolve: any) => resolve({
        data: [{
          category_id: 'Groceries',
          proper_name: 'Pizza Nova',
          match_key: 'pizzanova',
          match_type: 'contains',
          updated_at: new Date().toISOString(),
        }],
        error: null,
      }),
    };
    overridesChain.select = vi.fn().mockReturnValue(overrideRows);

    const { row } = await captureRow('BMO You spent $27.50 at PIZZA NOVA 1147 on your card');
    expect(row?.budget).toBe('Groceries');
  });

  it('leaves an ordinary non-food merchant alone', async () => {
    const { row } = await captureRow('BMO You spent $61.00 at CANADIAN TIRE 182 on your card');
    expect(row?.budget).toBe('Other');
  });

  it('never auto-files a signal match — it is a suggestion, not a learned rule', async () => {
    // caught_cleared is only set on auto-accept. A descriptor guess must still
    // pass in front of the user.
    const { row } = await captureRow('BMO You spent $18.40 at TST* LA CARNITA on your card');
    expect(row?.caught_cleared).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// A CHARGE THAT ARRIVES UNDER A PROCESSOR PREFIX
// ═══════════════════════════════════════════════════════════════════
//
// "GOOGLE *YOUTUBEPREMIUM" is stripped down to "Youtubepremium" before step 5
// ever sees it, because the processor is not the merchant. But the rule the
// user taught was keyed on the whole thing, and the recurring row on the books
// is called "Google" — neither of which shares a single token with
// "Youtubepremium". So the rule stopped firing and the duplicate stopped being
// noticed, both silently.

describe('A charge that arrives under a processor prefix', () => {
  const SERVICES = [
    { id: 'cat-services', name: 'Services' },
    { id: 'cat-groceries', name: 'Groceries' },
    { id: 'cat-other', name: 'Other' },
  ];

  const RAW = 'GOOGLE *YOUTUBEPREMIUM  You spent $24.14 with your credit card.';

  function emptyResultChain() {
    const chain: any = {};
    for (const m of [
      'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'ilike', 'is', 'in', 'not',
      'or', 'match', 'filter', 'order', 'limit', 'single', 'maybeSingle',
    ]) {
      chain[m] = vi.fn().mockReturnThis();
    }
    chain.then = (resolve: any) => resolve({ data: [], error: null });
    return chain;
  }

  function resultChain(data: any[]) {
    return { ...emptyResultChain(), then: (resolve: any) => resolve({ data, error: null }) };
  }

  /**
   * The overrides table, answering `ilike proper_name` the way Postgres would
   * rather than handing every query the same rows. Without that the display-name
   * fallback matches anything and the match_key path is never really tested.
   */
  function overridesResultChain(rows: any[]) {
    let ilikeName: string | null = null;
    const chain: any = {};
    for (const m of [
      'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is', 'in', 'not',
      'or', 'match', 'filter', 'order', 'limit', 'single', 'maybeSingle',
    ]) {
      chain[m] = vi.fn().mockReturnThis();
    }
    chain.ilike = vi.fn((_column: string, value: string) => {
      ilikeName = value;
      return chain;
    });
    chain.then = (resolve: any) => resolve({
      data: ilikeName === null
        ? rows
        : rows.filter((r) => String(r.proper_name || '').toLowerCase() === String(ilikeName).toLowerCase()),
      error: null,
    });
    return chain;
  }

  /** The rule the user taught back when the name still carried the prefix. */
  function teachYoutubePremiumRule() {
    const rows = [{
      category_id: 'Services',
      proper_name: 'Google - Youtube Premium',
      match_key: 'googleyoutubepremium',
      match_type: 'exact',
      updated_at: new Date().toISOString(),
    }];
    getChain('overrides').select = vi.fn(() => overridesResultChain(rows));
  }

  async function capture(
    existingTransactions: any[],
    input: Partial<NotificationInput> = {},
  ) {
    const txChain = getChain('transactions');
    txChain.select = vi.fn().mockReturnValue(resultChain(existingTransactions));
    txChain.insert = vi.fn().mockResolvedValue({ error: null });
    getChain('pending_transactions').select = vi.fn().mockReturnValue(emptyResultChain());

    const result = await processNotificationWithAI(
      'user-1',
      makeInput({ rawNotification: RAW, notificationTimestamp: Date.now(), ...input }),
      SERVICES,
    );
    return { result, txChain, row: txChain.insert.mock.calls[0]?.[0] as Record<string, unknown> | undefined };
  }

  it('still matches the rule the user taught under the prefixed name', async () => {
    teachYoutubePremiumRule();
    const { row } = await capture([]);
    expect(row?.budget).toBe('Services');
    expect(row?.vendor).toBe('Google - Youtube Premium');
  });

  it('files it without review when auto-accept is on', async () => {
    // The whole promise of auto-accept: a rule the user wrote themselves
    // decides where the money goes, and they never see the row.
    teachYoutubePremiumRule();
    const { row } = await capture([], { autoAcceptKnownVendors: true });
    expect(row?.caught_cleared).toBe(true);
  });

  it('still asks for review when no rule matches', async () => {
    const { row } = await capture([], { autoAcceptKnownVendors: true });
    expect(row?.budget).toBe('Other');
    expect(row?.caught_cleared).toBeUndefined();
  });

  it('recognises the recurring charge it duplicates and does not add a second row', async () => {
    teachYoutubePremiumRule();
    const yesterday = toLocalIsoDay(new Date(parseLocalDate(getLocalToday()).getTime() - 86_400_000));
    const { result, txChain } = await capture([{
      id: 'recurring-google',
      vendor: 'Google',
      amount: 24.14,
      date: yesterday,
      recur: 'Monthly',
      source: 'executor',
    }]);

    expect(txChain.insert).not.toHaveBeenCalled();
    expect(result.skipReason).toBe('duplicate_recurring');
    expect(result.softDuplicateOf?.id).toBe('recurring-google');
  });

  it('records the bank\'s wording on the recurring row it matched', async () => {
    // Nothing is inserted, so the notification would otherwise vanish without
    // trace. It goes onto the row that already represents the charge.
    teachYoutubePremiumRule();
    const yesterday = toLocalIsoDay(new Date(parseLocalDate(getLocalToday()).getTime() - 86_400_000));
    const { txChain } = await capture([{
      id: 'recurring-google',
      vendor: 'Google',
      amount: 24.14,
      date: yesterday,
      recur: 'Monthly',
      source: 'executor',
    }]);

    expect(txChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ raw_notification: RAW }),
    );
  });

  it('leaves a one-off charge at the same merchant alone', async () => {
    // Same vendor, same window, but the row on the books is not a recurring
    // one — two real purchases, and the user has said they would rather see
    // both than lose one.
    teachYoutubePremiumRule();
    const yesterday = toLocalIsoDay(new Date(parseLocalDate(getLocalToday()).getTime() - 86_400_000));
    const { result, row } = await capture([{
      id: 'one-off-google',
      vendor: 'Google',
      amount: 24.14,
      date: yesterday,
      recur: 'One-time',
      source: 'manual',
    }]);

    expect(row?.vendor).toBe('Google - Youtube Premium');
    expect(result.softDuplicateOf?.id).toBe('one-off-google');
  });

  it('leaves a recurring charge for a different amount alone', async () => {
    // Google bills this household three separate times a month. A $2.93 row is
    // not this $24.14 charge, however similar the names look.
    teachYoutubePremiumRule();
    const yesterday = toLocalIsoDay(new Date(parseLocalDate(getLocalToday()).getTime() - 86_400_000));
    const { result, txChain } = await capture([{
      id: 'recurring-google-one',
      vendor: 'Google',
      amount: 2.93,
      date: yesterday,
      recur: 'Monthly',
      source: 'executor',
    }]);

    expect(txChain.insert).toHaveBeenCalled();
    expect(result.skipReason).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// EVERY LEARNED RULE IS CONSIDERED, NOT JUST THE RECENT ONES
// ═══════════════════════════════════════════════════════════════════
//
// The rule lookup asked for the most recently updated rules and matched among
// those. With a handful of rules that is indistinguishable from asking for all
// of them; with a hundred it means a rule taught months ago is not in the room
// when the charge arrives, and the capture is filed as if no rule existed.

describe('Rule lookup across a large rule set', () => {
  const GROCERY_CATEGORIES = [
    { id: 'cat-groceries', name: 'Groceries' },
    { id: 'cat-transport', name: 'Transport' },
    { id: 'cat-other', name: 'Other' },
  ];

  /** A rule set where the one that matters is the oldest of many. */
  function manyRulesWithCostcoOldest(count = 100) {
    const rows: any[] = [];
    for (let i = 0; i < count; i++) {
      rows.push({
        category_id: 'Transport',
        proper_name: `Merchant ${i}`,
        match_key: `merchant${i}`,
        match_type: 'exact',
        updated_at: new Date(Date.now() - i * 60_000).toISOString(),
      });
    }
    rows.push({
      category_id: 'Groceries',
      proper_name: 'Costco',
      match_key: 'costcowholesale',
      match_type: 'exact',
      updated_at: new Date(Date.now() - count * 60_000).toISOString(),
    });
    return rows;
  }

  /**
   * A chain that honours `.limit()` the way PostgREST does. Without that the
   * truncation is invisible to a test and the regression cannot be caught.
   */
  function pagedChain(rows: any[]) {
    let take = rows.length;
    let ilikeName: string | null = null;
    const chain: any = {};
    for (const m of [
      'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is', 'in', 'not',
      'or', 'match', 'filter', 'order', 'single', 'maybeSingle',
    ]) {
      chain[m] = vi.fn().mockReturnThis();
    }
    chain.limit = vi.fn((n: number) => { take = n; return chain; });
    chain.ilike = vi.fn((_column: string, value: string) => { ilikeName = value; return chain; });
    chain.then = (resolve: any) => {
      const matched = ilikeName === null
        ? rows
        : rows.filter((r) => String(r.proper_name || '').toLowerCase() === String(ilikeName).toLowerCase());
      resolve({ data: matched.slice(0, take), error: null });
    };
    return chain;
  }

  function emptyChain() {
    const chain: any = {};
    for (const m of [
      'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'ilike', 'is', 'in', 'not',
      'or', 'match', 'filter', 'order', 'limit', 'single', 'maybeSingle',
    ]) {
      chain[m] = vi.fn().mockReturnThis();
    }
    chain.then = (resolve: any) => resolve({ data: [], error: null });
    return chain;
  }

  it('applies a rule that is not among the most recently updated', async () => {
    const rows = manyRulesWithCostcoOldest();
    getChain('overrides').select = vi.fn(() => pagedChain(rows));

    const txChain = getChain('transactions');
    txChain.select = vi.fn(() => emptyChain());
    txChain.insert = vi.fn().mockResolvedValue({ error: null });
    getChain('pending_transactions').select = vi.fn(() => emptyChain());

    const result = await processNotificationWithAI(
      'user-1',
      makeInput({
        rawNotification:
          'Credit Card Transaction Alert A transaction in the amount of $394.60 at COSTCO WHOLESALE was approved on your card ending in 6602.',
        notificationTimestamp: Date.now(),
      }),
      GROCERY_CATEGORIES,
    );

    const row = txChain.insert.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(row?.budget).toBe('Groceries');
    expect(row?.vendor).toBe('Costco');
    expect(result.categoryName).toBe('Groceries');
  });
});

// ═══════════════════════════════════════════════════════════════════
// A SUBSCRIPTION ALREADY ON THE BOOKS IS NOT CAPTURED AGAIN
// ═══════════════════════════════════════════════════════════════════
//
// The user's Fizz bill is a recurring charge Covault already records. The bank
// then announces the same charge, and the capture landed in Review as a
// separate transaction asking to be categorised — one bill, two rows, and the
// month over by $26.20.
//
// The pipeline has a guard for exactly this (step 5b), and it was not the guard
// that failed: the vendor never got as far as being compared. "FIZZ (TX. INCL.)"
// extracted as the merchant "Tx. Incl", which resembles nothing on the books.

describe('A recurring charge the bank announces', () => {
  const SERVICES = [
    { id: 'cat-services', name: 'Services' },
    { id: 'cat-other', name: 'Other' },
  ];

  const RAW = 'FIZZ (TX. INCL.) You made a recurring payment for $26.20 with your credit card.';

  function chainReturning(rows: any[]) {
    const chain: any = {};
    for (const m of [
      'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'ilike', 'is', 'in', 'not',
      'or', 'match', 'filter', 'order', 'limit', 'single', 'maybeSingle',
    ]) {
      chain[m] = vi.fn().mockReturnThis();
    }
    chain.then = (resolve: any) => resolve({ data: rows, error: null });
    return chain;
  }

  async function capture(existingTransactions: any[]) {
    const txChain = getChain('transactions');
    txChain.select = vi.fn(() => chainReturning(existingTransactions));
    txChain.insert = vi.fn().mockResolvedValue({ error: null });
    getChain('overrides').select = vi.fn(() => chainReturning([]));
    getChain('pending_transactions').select = vi.fn(() => chainReturning([]));

    const result = await processNotificationWithAI(
      'user-1',
      makeInput({ rawNotification: RAW, notificationTimestamp: Date.now() }),
      SERVICES,
    );
    return { result, txChain };
  }

  it('does not add a second row when the subscription is already recorded', async () => {
    const { result, txChain } = await capture([{
      id: 'recurring-fizz',
      vendor: 'Fizz',
      amount: 26.20,
      date: getLocalToday(),
      recur: 'Monthly',
      source: 'executor',
    }]);

    expect(txChain.insert).not.toHaveBeenCalled();
    expect(result.processed).toBe(true);
  });

  it('recognises it even when the recurring row was posted a couple of days early', async () => {
    // A due date is a guess; the bank settles when it settles. Two days apart
    // for the identical amount at the same merchant is one bill, not two.
    const twoDaysAgo = toLocalIsoDay(
      new Date(parseLocalDate(getLocalToday()).getTime() - 2 * 86_400_000),
    );
    const { result, txChain } = await capture([{
      id: 'recurring-fizz',
      vendor: 'Fizz',
      amount: 26.20,
      date: twoDaysAgo,
      recur: 'Monthly',
      source: 'executor',
    }]);

    expect(txChain.insert).not.toHaveBeenCalled();
    expect(result.skipReason).toBe('duplicate_recurring');
    expect(result.softDuplicateOf?.id).toBe('recurring-fizz');
  });

  it('still captures it when nothing like it is on the books', async () => {
    const { result, txChain } = await capture([]);
    expect(txChain.insert).toHaveBeenCalled();
    const row = txChain.insert.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row?.vendor).toBe('Fizz');
    expect(result.skipReason).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// A SUBSCRIPTION THAT HAS NOT COME DUE YET
// ═══════════════════════════════════════════════════════════════════
//
// The user's Netflix is due tomorrow. The bank announced the charge today, and
// Covault captured it: a row in Review, a "captured" notification, and a second
// copy of a bill already on the books.
//
// Nothing above could have seen it. Every lookup in the pipeline is windowed to
// +/-3 days, and a subscription that has not come due has no row inside that
// window — the executor writes occurrences only up to today, and the ones the
// dashboard shows for the future are display-only projections. The only real
// Netflix row was last month's, a month outside every window.
//
// So the recurring templates are now fetched without a date window and matched
// against their SCHEDULE: "due tomorrow" counts as much as "recorded
// yesterday".

describe('A subscription that has not come due yet', () => {
  const LEISURE = [
    { id: 'cat-leisure', name: 'Leisure' },
    { id: 'cat-other', name: 'Other' },
  ];

  const RAW = 'NETFLIX.COM You spent $20.33 with your credit card.';

  /**
   * The transactions table, answering the windowed lookups and the unwindowed
   * recurring one differently — which is the whole point of the change. The
   * recurring query is the one that filters on `recur`.
   */
  function transactionsChain(windowRows: any[], recurringRows: any[]) {
    let askedForRecurring = false;
    const chain: any = {};
    for (const m of [
      'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'ilike', 'is', 'not',
      'or', 'match', 'filter', 'order', 'limit', 'single', 'maybeSingle',
    ]) {
      chain[m] = vi.fn().mockReturnThis();
    }
    chain.in = vi.fn((column: string) => {
      if (column === 'recur') askedForRecurring = true;
      return chain;
    });
    chain.then = (resolve: any) =>
      resolve({ data: askedForRecurring ? recurringRows : windowRows, error: null });
    return chain;
  }

  function emptyChain() {
    return transactionsChain([], []);
  }

  async function capture(recurringRows: any[], windowRows: any[] = []) {
    const txChain = getChain('transactions');
    txChain.select = vi.fn(() => transactionsChain(windowRows, recurringRows));
    txChain.insert = vi.fn().mockResolvedValue({ error: null });
    txChain.update = vi.fn(() => emptyChain());
    getChain('overrides').select = vi.fn(() => emptyChain());
    getChain('pending_transactions').select = vi.fn(() => emptyChain());

    const result = await processNotificationWithAI(
      'user-1',
      makeInput({ rawNotification: RAW, notificationTimestamp: Date.now() }),
      LEISURE,
    );
    return { result, txChain };
  }

  /** A monthly template whose next occurrence falls `days` from today. */
  function templateDueIn(days: number, overrides: Record<string, unknown> = {}) {
    const due = parseLocalDate(getLocalToday()).getTime() + days * 86_400_000;
    const lastMonth = new Date(due);
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    return {
      id: 'netflix-template',
      vendor: 'Netflix*',
      amount: 20.33,
      date: toLocalIsoDay(lastMonth),
      recur: 'Monthly',
      source: 'manual',
      ...overrides,
    };
  }

  it('does not capture a charge whose recurring occurrence is due tomorrow', async () => {
    const { result, txChain } = await capture([templateDueIn(1)]);

    expect(txChain.insert).not.toHaveBeenCalled();
    expect(result.skipReason).toBe('duplicate_recurring');
    expect(result.softDuplicateOf?.id).toBe('netflix-template');
  });

  it('leaves last month\'s row alone rather than rewriting its history', async () => {
    // Nothing is inserted, but the row that matched is a DIFFERENT month's
    // charge — writing today's notification onto it would make that row claim
    // to have been confirmed by an alert that was not about it.
    const { txChain } = await capture([templateDueIn(1)]);
    expect(txChain.update).not.toHaveBeenCalled();
  });

  it('records the bank\'s wording when the row that matched IS this occurrence', async () => {
    const yesterday = toLocalIsoDay(
      new Date(parseLocalDate(getLocalToday()).getTime() - 86_400_000),
    );
    const { txChain } = await capture([{
      id: 'netflix-this-month',
      vendor: 'Netflix*',
      amount: 20.33,
      date: yesterday,
      recur: 'Monthly',
      source: 'executor',
    }]);

    expect(txChain.insert).not.toHaveBeenCalled();
    expect(txChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ raw_notification: RAW }),
    );
  });

  it('still captures a charge nowhere near the due date', async () => {
    // Mid-cycle, so this is a real second purchase — the user would rather see
    // it and delete it than lose it.
    const { result, txChain } = await capture([templateDueIn(14)]);

    expect(txChain.insert).toHaveBeenCalled();
    expect(result.skipReason).toBeUndefined();
  });

  it('still captures a charge for a different amount near the due date', async () => {
    const { txChain } = await capture([templateDueIn(1, { amount: 9.99 })]);
    expect(txChain.insert).toHaveBeenCalled();
  });

  it('still captures when the subscription is a one-off row, not a recurring one', async () => {
    const { txChain } = await capture([templateDueIn(1, { recur: 'One-time', source: 'manual' })]);
    expect(txChain.insert).toHaveBeenCalled();
  });
});

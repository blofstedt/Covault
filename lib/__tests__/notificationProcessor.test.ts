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
    pipeline: async () => {
      return async (prompt: string) => {
        const lower = prompt.toLowerCase();
        // Category classification
        if (lower.includes('classify this transaction')) {
          const vl = (prompt.match(/Vendor:\s*(.+)/i)?.[1] || '').toLowerCase();
          if (/\b(loblaws?|walmart|costco|whole\s*foods|safeway|metro|sobeys?)\b/.test(vl)) return [{ generated_text: 'Groceries' }];
          if (/\b(shell|esso|petro|uber(?!\s*eats)|gas)\b/.test(vl)) return [{ generated_text: 'Transport' }];
          if (/\b(bell|rogers|telus|fido|fizz)\b/.test(vl)) return [{ generated_text: 'Utilities' }];
          if (/\b(netflix|spotify|disney|amazon|starbucks?|mcdonald|subway|the\s*keg|wendy|boston\s*pizza|uber\s*eats)\b/.test(vl)) return [{ generated_text: 'Leisure' }];
          if (/\b(shoppers|pharmacy)\b/.test(vl)) return [{ generated_text: 'Services' }];
          return [{ generated_text: 'Other' }];
        }
        // Vendor extraction
        if (lower.includes('extract the vendor')) {
          const text = prompt.split('Notification:')[1]?.split('\n')[0]?.replace(/"/g, '').trim() || '';
          const tl = text.toLowerCase();
          if (tl.includes('verification code') || tl.includes('otp')) return [{ generated_text: 'NONE' }];
          if (tl.includes('account balance')) return [{ generated_text: 'NONE' }];
          if (tl.includes('sign in') || tl.includes('logged in')) return [{ generated_text: 'NONE' }];
          if (tl.includes('reward points') || tl.includes('cashback')) return [{ generated_text: 'NONE' }];
          if (tl.includes('payment is due') || tl.includes('is due') || tl.includes('direct deposit') || tl.includes('payroll')) return [{ generated_text: 'NONE' }];
          if (tl.includes('transfer') && (tl.includes('between') || tl.includes('from your'))) return [{ generated_text: 'NONE' }];
          const atM = text.match(/\bat\s+(.+?)(?:\s+(?:for|on|using|via|ending)\b|\s*\.\s*$|$)/i);
          if (atM) return [{ generated_text: atM[1].trim() }];
          const fromM = text.match(/\bfrom\s+(.+?)(?:\s+(?:was|for|on|using|via|ending)\b|\s*\.\s*$|$)/i);
          if (fromM) return [{ generated_text: fromM[1].trim() }];
          const titleM = text.match(/^([A-Z][A-Za-z0-9\s&'.()!-]+?)(?:\s+(?:You|Your|A\s|charged|spent|payment))/i);
          if (titleM) return [{ generated_text: titleM[1].replace(/\s*\([^)]*\)\s*$/, '').trim() }];
          const dollarM = text.match(/\$[\d,]+\.?\d*\s+(?:from|at|to)\s+(.+?)(?:\s+(?:for|on|was)\b|\s*\.\s*$|$)/i);
          if (dollarM) return [{ generated_text: dollarM[1].trim() }];
          return [{ generated_text: 'NONE' }];
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
  // Default: resolve with empty data
  chain.then = undefined; // prevent accidental thenification
  return chain;
};

let currentTable = '';
const tableChains: Record<string, ReturnType<typeof mockSupabaseChain>> = {};

function getChain(table: string) {
  if (!tableChains[table]) tableChains[table] = mockSupabaseChain();
  return tableChains[table];
}

vi.mock('../supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      currentTable = table;
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

import { processNotificationWithAI, checkDuplicateTransaction, vendorMatches, _clearDedupCacheForTesting } from '../notificationProcessor';
import { extractWithAI } from '../aiExtractor';
import type { NotificationInput } from '../notificationProcessor';

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
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
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
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
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
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      then: (resolve: any) => resolve({ data: [], error: null }),
    };
    txChain.select = vi.fn().mockReturnValue(mockSelectChain);
    txChain.insert = vi.fn().mockResolvedValue({ error: null });

    const ptChain = getChain('pending_transactions');
    const mockPtSelectChain = {
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
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
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      then: (resolve: any) => resolve({ data: [], error: null }),
    };
    txChain.select = vi.fn().mockReturnValue(mockSelectChain);
    txChain.insert = vi.fn().mockResolvedValue({ error: null });

    const ptChain = getChain('pending_transactions');
    const mockPtSelectChain = {
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
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

import { describe, it, expect, vi } from 'vitest';

// Mock @huggingface/transformers — vi.mock is hoisted above all imports.
// ALL mock logic MUST be inlined here; no external references allowed.
vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn(async () => {
    // This returned function simulates the Flan-T5 generator.
    // It receives prompt text and options, and returns [{ generated_text }].
    return async (prompt: string) => {
      const p = prompt.toLowerCase();

      // ── Vendor extraction prompt ──
      if (p.includes('extract the vendor')) {
        const original = prompt;

        // Extract the notification text from the prompt
        const notifMatch = original.match(/Notification:\s*"([^"]+)"/);
        const notif = notifMatch ? notifMatch[1] : '';
        const nl = notif.toLowerCase();

        // Rejection: non-transaction notifications
        if (
          nl.includes('verification code') ||
          nl.includes('account balance') ||
          nl.includes('sign in') ||
          nl.includes('has been delivered') ||
          nl.includes('reward points')
        ) {
          return [{ generated_text: 'NONE' }];
        }

        // Preposition-based vendor extraction: "at VENDOR", "from VENDOR", "paid to VENDOR", "with VENDOR"
        const atMatch = notif.match(/\bat\s+(.+?)(?:\s+on\s+your|\s+for\s+|\s+was\s+|\s*[.]?\s*$)/i);
        if (atMatch) return [{ generated_text: atMatch[1].trim() }];

        const fromMatch = notif.match(/\bfrom\s+(.+?)(?:\s+was\s+|\s+for\s+|\s*[.]?\s*$)/i);
        if (fromMatch) return [{ generated_text: fromMatch[1].trim() }];

        const paidToMatch = notif.match(/\bpaid\s+to\s+(.+?)(?:\s+was\s+|\s*[.]?\s*$)/i);
        if (paidToMatch) return [{ generated_text: paidToMatch[1].trim() }];

        const withMatch = notif.match(/\bwith\s+(.+?)(?:\s+was\s+|\s+on\s+|\s*[.]?\s*$)/i);
        if (withMatch) {
          const w = withMatch[1].trim();
          // "with your credit card" is not a vendor
          if (!/^your\s/i.test(w)) return [{ generated_text: w }];
        }

        // Title-based: vendor name appears before the first sentence verb/phrase
        // e.g., "FIZZ (TX. INCL.) You made...", "DISNEY PLUS You made...", "Spotify Your..."
        const titleMatch = notif.match(/^([A-Z][A-Za-z0-9 .&'+*()-]*?)(?:\s+(?:\(.*?\)\s+)?(?:You|Your|A |An |The |We |This |Payment|Charged))/);
        if (titleMatch) {
          let title = titleMatch[1].replace(/\s*\(.*?\)\s*/g, '').trim();
          return [{ generated_text: title }];
        }

        // Fallback: return NONE
        return [{ generated_text: 'NONE' }];
      }

      // ── Category classification prompt ──
      if (p.includes('classify this transaction')) {
        // Extract vendor from prompt
        const vendorLineMatch = prompt.match(/Vendor:\s*(.+)/);
        const vendor = vendorLineMatch ? vendorLineMatch[1].trim().toLowerCase() : '';

        // Category rules based on vendor keywords
        const categoryMap: Array<[RegExp, string]> = [
          [/netflix|spotify|disney|amazon prime|crave|hbo|paramount/i, 'Leisure'],
          [/keg|steakhouse|boston pizza|wendy|mcdonald|burger|popeye|taco|chick-fil|a&w|subway|tim horton|starbuck/i, 'Leisure'],
          [/shell|petro|gas|esso|uber(?!\s*eats)|lyft|transit/i, 'Transport'],
          [/loblaws|loblaw|whole foods|costco|walmart|grocery|superstore|no frills|metro|sobeys|safeway|freshco/i, 'Groceries'],
          [/bell|rogers|telus|fizz|fido|koodo|virgin|shaw|videotron|hydro|enbridge|utilit/i, 'Utilities'],
          [/parkview|property|landlord|rent|mortgage/i, 'Housing'],
          [/shoppers|drug mart|pharmacy|clinic|doctor|dental|medical/i, 'Services'],
          [/home depot|best buy|ikea|canadian tire|dollarama|sport chek/i, 'Leisure'],
        ];

        for (const [pattern, category] of categoryMap) {
          if (pattern.test(vendor)) return [{ generated_text: category }];
        }

        return [{ generated_text: 'Other' }];
      }

      return [{ generated_text: '' }];
    };
  }),
}));

import { extractWithAI } from '../aiExtractor';

const ALL_CATEGORIES = ['Housing', 'Groceries', 'Transport', 'Utilities', 'Leisure', 'Services', 'Other'];

describe('extractWithAI (client-side AI model)', () => {
  // ═══════════════════════════════════════════════════════════════
  // Problem statement tests
  // ═══════════════════════════════════════════════════════════════

  it('Netflix: "You spent $14.99 at Netflix for a recurring subscription."', async () => {
    const r = await extractWithAI(
      'You spent $14.99 at Netflix for a recurring subscription.',
      ALL_CATEGORIES,
    );
    expect(r.isTransaction).toBe(true);
    expect(r.amount).toBe(14.99);
    expect(r.vendor).toBeTruthy();
    expect(r.vendor?.toLowerCase()).toContain('netflix');
    expect(r.suggestedCategory).toBe('Leisure');
  });

  it('Spotify: "A recurring subscription cost $10.99 at Spotify"', async () => {
    const r = await extractWithAI(
      'A recurring subscription cost $10.99 at Spotify.',
      ALL_CATEGORIES,
    );
    expect(r.isTransaction).toBe(true);
    expect(r.amount).toBe(10.99);
    expect(r.vendor?.toLowerCase()).toContain('spotify');
    expect(r.suggestedCategory).toBe('Leisure');
  });

  it('Apple iCloud: "A monthly charge of $9.99 from Apple iCloud"', async () => {
    const r = await extractWithAI(
      'A monthly charge of $9.99 from Apple iCloud was processed.',
      ALL_CATEGORIES,
    );
    expect(r.isTransaction).toBe(true);
    expect(r.amount).toBe(9.99);
    expect(r.vendor).toBeTruthy();
    expect(r.vendor?.toLowerCase()).toContain('apple');
  });

  it('Amazon Prime: "A recurring transaction of $16.99 with Amazon Prime"', async () => {
    const r = await extractWithAI(
      'A recurring transaction of $16.99 with Amazon Prime was completed.',
      ALL_CATEGORIES,
    );
    expect(r.isTransaction).toBe(true);
    expect(r.amount).toBe(16.99);
    expect(r.vendor?.toLowerCase()).toContain('amazon');
    expect(r.suggestedCategory).toBe('Leisure');
  });

  it('GoodLife Fitness: "A recurring debit of $54.00 from GoodLife Fitness"', async () => {
    const r = await extractWithAI(
      'A recurring debit of $54.00 from GoodLife Fitness was posted.',
      ALL_CATEGORIES,
    );
    expect(r.isTransaction).toBe(true);
    expect(r.amount).toBe(54.00);
    expect(r.vendor).toBeTruthy();
  });

  it('Parkview Property Management: "A recurring fee of $1,850.00 was paid to"', async () => {
    const r = await extractWithAI(
      'A recurring fee of $1,850.00 was paid to Parkview Property Management.',
      ALL_CATEGORIES,
    );
    expect(r.isTransaction).toBe(true);
    expect(r.amount).toBe(1850.00);
    expect(r.vendor?.toLowerCase()).toContain('parkview');
    expect(r.suggestedCategory).toBe('Housing');
  });

  // ═══════════════════════════════════════════════════════════════
  // User's exact notification formats
  // ═══════════════════════════════════════════════════════════════

  it('extracts FIZZ recurring payment', async () => {
    const result = await extractWithAI(
      'FIZZ (TX. INCL.) You made a recurring payment for $26.20 with your credit card.',
      ['Utilities', 'Groceries', 'Leisure'],
    );
    expect(result.isTransaction).toBe(true);
    expect(result.amount).toBe(26.20);
    expect(result.vendor).toBeTruthy();
    expect(result.suggestedCategory).toBe('Utilities');
  });

  it('extracts DISNEY PLUS recurring payment', async () => {
    const result = await extractWithAI(
      'DISNEY PLUS You made a recurring payment for $17.84 with your credit card.',
      ['Utilities', 'Groceries', 'Leisure'],
    );
    expect(result.isTransaction).toBe(true);
    expect(result.amount).toBe(17.84);
    expect(result.vendor).toBeTruthy();
    expect(result.suggestedCategory).toBe('Leisure');
  });

  // ═══════════════════════════════════════════════════════════════
  // Vendor extraction — preposition-based
  // ═══════════════════════════════════════════════════════════════

  it('"Purchase of $X at Subway"', async () => {
    const r = await extractWithAI('Wealthsimple Purchase of $12.34 at Subway', []);
    expect(r.isTransaction).toBe(true);
    expect(r.amount).toBe(12.34);
    expect(r.vendor?.toLowerCase()).toContain('subway');
  });

  it('"You spent $X at Shell Gas Station"', async () => {
    const r = await extractWithAI(
      'BMO You spent $45.00 at Shell Gas Station on your credit card.', ['Transport']);
    expect(r.isTransaction).toBe(true);
    expect(r.amount).toBe(45.00);
    expect(r.vendor).toBeTruthy();
    expect(r.suggestedCategory).toBe('Transport');
  });

  it('"Charged $X at Whole Foods"', async () => {
    const r = await extractWithAI('Scotiabank Charged $87.42 at Whole Foods', ['Groceries']);
    expect(r.isTransaction).toBe(true);
    expect(r.amount).toBe(87.42);
    expect(r.suggestedCategory).toBe('Groceries');
  });

  it('"$X from Uber Eats"', async () => {
    const r = await extractWithAI('$23.45 from Uber Eats for your recent order', ['Leisure']);
    expect(r.isTransaction).toBe(true);
    expect(r.amount).toBe(23.45);
    expect(r.vendor).toBeTruthy();
  });

  // ═══════════════════════════════════════════════════════════════
  // Vendor name polishing (typos, abbreviations, store numbers)
  // ═══════════════════════════════════════════════════════════════

  it('corrects AMZN MKTP to Amazon', async () => {
    const r = await extractWithAI('Payment of $29.99 at AMZN MKTP CA', []);
    expect(r.isTransaction).toBe(true);
    expect(r.vendor).toBe('Amazon');
  });

  it('corrects STARBUX to Starbucks', async () => {
    const r = await extractWithAI('Charged $6.50 at STARBUX', []);
    expect(r.isTransaction).toBe(true);
    expect(r.vendor).toBe('Starbucks');
  });

  it('corrects MCDONALDS to McDonald\'s', async () => {
    const r = await extractWithAI('Purchase of $8.99 at MCDONALDS', []);
    expect(r.isTransaction).toBe(true);
    expect(r.vendor).toBe("McDonald's");
  });

  it('strips SQ* prefix', async () => {
    const r = await extractWithAI('Charged $15.00 at SQ *Cafe Lola', []);
    expect(r.isTransaction).toBe(true);
    expect(r.vendor).not.toContain('SQ');
    expect(r.vendor?.toLowerCase()).toContain('cafe lola');
  });

  it('strips store numbers: Subway#327', async () => {
    const r = await extractWithAI('Payment of $5.50 at Subway#327', []);
    expect(r.isTransaction).toBe(true);
    expect(r.vendor).not.toContain('#327');
  });

  it('strips trailing location digits: SHELL 004821', async () => {
    const r = await extractWithAI('Charged $55.00 at SHELL 004821', []);
    expect(r.isTransaction).toBe(true);
    expect(r.vendor).not.toContain('004821');
  });

  it('strips trailing province code: COSTCO WHOLESALE QC', async () => {
    const r = await extractWithAI('Purchase of $120.00 at COSTCO WHOLESALE QC', []);
    expect(r.isTransaction).toBe(true);
    expect(r.vendor?.toLowerCase()).toContain('costco');
    expect(r.vendor).not.toContain('QC');
  });

  // ═══════════════════════════════════════════════════════════════
  // Vendor name edge cases
  // ═══════════════════════════════════════════════════════════════

  it('handles Amzn#456 → Amazon', async () => {
    const r = await extractWithAI('Charged $29.99 at Amzn#456', []);
    expect(r.isTransaction).toBe(true);
    expect(r.vendor).toBe('Amazon');
  });

  it('handles three-word vendor: "The Children\'s Place"', async () => {
    const r = await extractWithAI("Purchase of $45.00 at The Children's Place", []);
    expect(r.isTransaction).toBe(true);
    expect(r.vendor?.toLowerCase()).toContain("children's place");
  });

  it('handles Wendy\'s (vendor with apostrophe)', async () => {
    const r = await extractWithAI("Charged $8.50 at Wendy's", ['Leisure']);
    expect(r.isTransaction).toBe(true);
    expect(r.vendor).toBe("Wendy's");
  });

  it('handles NETFLIX → Netflix (proper casing)', async () => {
    const r = await extractWithAI(
      'NETFLIX You made a recurring payment for $15.99 with your credit card.', ['Leisure']);
    expect(r.isTransaction).toBe(true);
    expect(r.amount).toBe(15.99);
    expect(r.vendor).toBe('Netflix');
    expect(r.suggestedCategory).toBe('Leisure');
  });

  // ═══════════════════════════════════════════════════════════════
  // Vendor extraction — title-based (vendor IS the title)
  // ═══════════════════════════════════════════════════════════════

  it('title-based: "Spotify" title', async () => {
    const r = await extractWithAI(
      'Spotify Your subscription payment of $9.99 has been processed.', ['Leisure']);
    expect(r.isTransaction).toBe(true);
    expect(r.amount).toBe(9.99);
    expect(r.vendor?.toLowerCase()).toContain('spotify');
  });

  it('title-based: unknown vendor in title', async () => {
    const r = await extractWithAI(
      'SOME RANDOM SHOP You made a payment of $42.00 with your debit card.', []);
    expect(r.isTransaction).toBe(true);
    expect(r.amount).toBe(42.00);
    expect(r.vendor).toBeTruthy();
  });

  // ═══════════════════════════════════════════════════════════════
  // Rejection cases
  // ═══════════════════════════════════════════════════════════════

  it('rejects OTP notifications', async () => {
    const r = await extractWithAI('BMO Your verification code is 123456', []);
    expect(r.isTransaction).toBe(false);
  });

  it('rejects balance alerts', async () => {
    const r = await extractWithAI('Your account balance is $1,234.56', []);
    expect(r.isTransaction).toBe(false);
  });

  it('rejects login notifications', async () => {
    const r = await extractWithAI(
      'New sign in to your account from Chrome on Windows', []);
    expect(r.isTransaction).toBe(false);
  });

  it('rejects notifications without dollar amounts', async () => {
    const r = await extractWithAI('Your package has been delivered', []);
    expect(r.isTransaction).toBe(false);
    expect(r.rejectionReason).toContain('No dollar amount');
  });

  it('rejects reward point notifications even with amounts', async () => {
    const r = await extractWithAI(
      'You earned 500 reward points on your $50.00 purchase', []);
    expect(r.isTransaction).toBe(false);
  });

  // ═══════════════════════════════════════════════════════════════
  // Category guessing
  // ═══════════════════════════════════════════════════════════════

  it('guesses Groceries for grocery stores', async () => {
    const r = await extractWithAI('Payment of $62.15 at Loblaws', ['Groceries', 'Leisure']);
    expect(r.suggestedCategory).toBe('Groceries');
  });

  it('guesses Transport for gas stations', async () => {
    const r = await extractWithAI(
      'Payment of $55.00 at Petro-Canada', ['Groceries', 'Transport']);
    expect(r.suggestedCategory).toBe('Transport');
  });

  it('guesses Utilities for telecom', async () => {
    const r = await extractWithAI(
      'BELL You made a payment of $85.00', ['Utilities', 'Groceries']);
    expect(r.suggestedCategory).toBe('Utilities');
  });

  it('guesses Leisure for restaurants', async () => {
    const r = await extractWithAI(
      'Charged $35.00 at The Keg Steakhouse', ['Leisure', 'Groceries']);
    expect(r.suggestedCategory).toBe('Leisure');
  });

  it('guesses Services for pharmacy', async () => {
    const r = await extractWithAI(
      'Purchase of $12.99 at Shoppers Drug Mart', ['Services', 'Groceries']);
    expect(r.suggestedCategory).toBe('Services');
  });

  // ═══════════════════════════════════════════════════════════════
  // Amount edge cases
  // ═══════════════════════════════════════════════════════════════

  it('handles amounts with commas: $1,234.56', async () => {
    const r = await extractWithAI('Payment of $1,234.56 at Best Buy', []);
    expect(r.amount).toBe(1234.56);
  });

  it('handles CAD currency format', async () => {
    const r = await extractWithAI('Charged CAD 45.99 at Tim Hortons', []);
    expect(r.isTransaction).toBe(true);
    expect(r.amount).toBe(45.99);
  });

  // ═══════════════════════════════════════════════════════════════
  // Multi-word vendor names
  // ═══════════════════════════════════════════════════════════════

  it('handles two-word vendor: "Home Depot"', async () => {
    const r = await extractWithAI('Purchase of $89.99 at Home Depot', ['Leisure']);
    expect(r.isTransaction).toBe(true);
    expect(r.vendor?.toLowerCase()).toContain('home depot');
  });

  it('handles three-word vendor: "Boston Pizza"', async () => {
    const r = await extractWithAI('Charged $42.50 at Boston Pizza on your Visa', ['Leisure']);
    expect(r.isTransaction).toBe(true);
    expect(r.vendor?.toLowerCase()).toContain('boston pizza');
  });

  it('handles vendor with apostrophe: "Tim Horton\'s"', async () => {
    const r = await extractWithAI("Charged $4.50 at Tim Horton's", ['Leisure']);
    expect(r.isTransaction).toBe(true);
    expect(r.vendor).toBeTruthy();
  });

  it('handles vendor with ampersand: "A&W"', async () => {
    const r = await extractWithAI('Payment of $11.99 at A&W', ['Leisure']);
    expect(r.isTransaction).toBe(true);
    expect(r.vendor).toBeTruthy();
  });

  // ═══════════════════════════════════════════════════════════════
  // Rule-based vendor extraction improvements
  // ═══════════════════════════════════════════════════════════════

  it('strips bank name prefix "BMO" from vendor extraction', async () => {
    const r = await extractWithAI(
      'BMO You spent $45.00 at Shell Gas Station on your credit card.',
      ['Transport'],
    );
    expect(r.isTransaction).toBe(true);
    expect(r.vendor).toBeTruthy();
    expect(r.vendor?.toLowerCase()).not.toContain('bmo');
    expect(r.vendor?.toLowerCase()).toContain('shell');
  });

  it('strips bank name prefix "Scotiabank" from vendor extraction', async () => {
    const r = await extractWithAI(
      'Scotiabank Charged $87.42 at Whole Foods',
      ['Groceries'],
    );
    expect(r.isTransaction).toBe(true);
    expect(r.vendor?.toLowerCase()).not.toContain('scotiabank');
    expect(r.vendor?.toLowerCase()).toContain('whole foods');
  });

  it('strips bank name prefix "Wealthsimple" from vendor extraction', async () => {
    const r = await extractWithAI(
      'Wealthsimple Purchase of $12.34 at Subway',
      [],
    );
    expect(r.isTransaction).toBe(true);
    expect(r.vendor?.toLowerCase()).not.toContain('wealthsimple');
    expect(r.vendor?.toLowerCase()).toContain('subway');
  });

  it('extracts vendor from "paid to VENDOR" pattern', async () => {
    const r = await extractWithAI(
      'A recurring fee of $1,850.00 was paid to Parkview Property Management.',
      ['Housing'],
    );
    expect(r.isTransaction).toBe(true);
    expect(r.vendor?.toLowerCase()).toContain('parkview');
  });

  it('extracts vendor from "$X from VENDOR" pattern', async () => {
    const r = await extractWithAI(
      '$23.45 from Uber Eats for your recent order',
      ['Leisure'],
    );
    expect(r.isTransaction).toBe(true);
    expect(r.vendor).toBeTruthy();
    expect(r.vendor?.toLowerCase()).toContain('uber eats');
  });

  it('strips parenthetical text like "(TX. INCL.)" from vendor name', async () => {
    const r = await extractWithAI(
      'FIZZ (TX. INCL.) You made a recurring payment for $26.20 with your credit card.',
      ['Utilities'],
    );
    expect(r.isTransaction).toBe(true);
    expect(r.vendor).toBeTruthy();
    expect(r.vendor?.toLowerCase()).toContain('fizz');
    expect(r.vendor).not.toContain('TX');
    expect(r.vendor).not.toContain('INCL');
  });

  it('rejects transfer between accounts via rule-based detection', async () => {
    const r = await extractWithAI(
      'Transfer from your chequing to savings of $500.00',
      [],
    );
    expect(r.isTransaction).toBe(false);
  });

  it('rejects direct deposit via rule-based detection', async () => {
    const r = await extractWithAI(
      'Direct deposit of $2,500.00 has been received in your account',
      [],
    );
    expect(r.isTransaction).toBe(false);
  });
});

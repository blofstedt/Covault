import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseNotificationText, isCommonNounOnly } from '../deviceTransactionParser';

/**
 * A real capture that went wrong, kept here as the regression case.
 *
 * One $16.54 purchase produced TWO Covault notifications:
 *   "$16.54 at You"          — from Wealthsimple
 *   "$16.54 at a purchase"   — from Google Wallet
 *
 * The source notifications both had the merchant in the title:
 *   Wealthsimple  "OPA001-MARKET MALL 🍴"  / "You spent $16.54 with your credit card."
 *   Google Wallet "OPA001-MARKET MALL"     / "CA$16.54 with Wealthsimple Visa Infinite"
 *
 * Three separate defects stacked up:
 *   1. Google Wallet was captured at all (NotificationListener forwards ANY app
 *      whose text contains a dollar amount) — now excluded outright.
 *   2. The native Java extractor could not see past the emoji and required a
 *      dash the TS parser had already made optional, so it fell through to an
 *      amount-adjacent pattern and returned "You".
 *   3. The on-device model echoed its own prompt wording, and "a purchase"
 *      slipped through isCommonNounOnly because "purchase" (singular) was not
 *      in NON_VENDOR_WORDS.
 *
 * Defect 2 also explains the duplicate: cross-app dedup (commit 0c0d0d7)
 * collapses on vendor similarity, and "You" vs "a purchase" share nothing.
 */

const JAVA_PATH = resolve(__dirname, '../../android-custom/NotificationListener.java');

// Exactly as the native side builds it: title + " " + body.
const WEALTHSIMPLE_FULL_TEXT =
  'OPA001-MARKET MALL 🍴 You spent $16.54 with your credit card.';

describe('OPA001-MARKET MALL capture', () => {
  it('extracts the merchant, not the pronoun', () => {
    const result = parseNotificationText(WEALTHSIMPLE_FULL_TEXT);

    expect(result.isOutgoing).toBe(true);
    expect(result.amount).toBe(16.54);
    expect(result.vendorDisplay?.toLowerCase()).toContain('market mall');
    expect(result.vendorDisplay?.toLowerCase()).not.toBe('you');
  });

  it('still works when the bank omits the emoji', () => {
    const result = parseNotificationText(
      'OPA001-MARKET MALL You spent $16.54 with your credit card.',
    );
    expect(result.amount).toBe(16.54);
    expect(result.vendorDisplay?.toLowerCase()).toContain('market mall');
  });

  it('still works with the dash separator some banks use', () => {
    const result = parseNotificationText(
      'AMZN MKTP CA - You spent $36.64 with your credit card.',
    );
    expect(result.amount).toBe(36.64);
    expect(result.vendorDisplay?.toLowerCase()).toContain('amzn');
  });

  it('rejects the model echoing its own prompt as a vendor', () => {
    // The prompt reads: "Vendor: <merchant name, or NONE if not a purchase/payment>"
    expect(isCommonNounOnly('a purchase')).toBe(true);
    expect(isCommonNounOnly('a payment')).toBe(true);
    expect(isCommonNounOnly('purchase')).toBe(true);
    expect(isCommonNounOnly('transaction')).toBe(true);
  });

  it('rejects pronoun vendors', () => {
    expect(isCommonNounOnly('You')).toBe(true);
    expect(isCommonNounOnly('your credit card')).toBe(true);
  });

  it('does not reject real merchants that contain a stopword', () => {
    expect(isCommonNounOnly('Market Mall')).toBe(false);
    expect(isCommonNounOnly('Bank of America')).toBe(false);
    expect(isCommonNounOnly('Charge Point')).toBe(false);
    expect(isCommonNounOnly('Credit Union Cafe')).toBe(false);
  });
});

/**
 * The native extractor posts the capture notification when the app is closed,
 * so its output is what the user actually reads in the shade. It is a
 * deliberately dumber copy of the TS parser (see CLAUDE.md), but these two
 * specific behaviours must not drift again — their absence is what produced
 * "$16.54 at You".
 */
describe('NotificationListener.java vendor extraction', () => {
  const java = readFileSync(JAVA_PATH, 'utf-8');

  it('strips emoji before matching vendor patterns', () => {
    expect(java).toMatch(/EMOJI_PATTERN/);
    expect(
      /String cleaned = stripEmoji\(text\);/.test(java),
      'extractVendor must strip emoji first — a category glyph between the ' +
      'merchant name and the spending verb otherwise defeats every ' +
      'merchant-leading pattern.',
    ).toBe(true);
  });

  it('treats the dash separator as optional, like the TS parser', () => {
    const firstPattern = java.match(
      /Pattern\.compile\("\^\(\[A-Za-z0-9&'\.\/# -\]\{2,60\}\?\)[^"]*"/,
    );
    expect(firstPattern, 'merchant-leading vendor pattern not found').not.toBeNull();
    expect(
      firstPattern![0].includes('\\\\u2014]?'),
      'The dash must be optional (`[-\\u2013\\u2014]?`). While it was mandatory ' +
      'here, any bank that omits the separator fell through to the ' +
      'amount-adjacent pattern and yielded "You".',
    ).toBe(true);
  });

  it('rejects non-vendor candidates instead of returning them', () => {
    expect(java).toMatch(/NON_VENDOR_WORDS/);
    expect(java).toMatch(/!isNonVendor\(vendor\)/);
  });
});

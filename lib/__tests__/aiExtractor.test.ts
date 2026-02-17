import { describe, it, expect } from 'vitest';
import { extractWithAI } from '../aiExtractor';

describe('extractWithAI (local extraction)', () => {
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
  // Vendor extraction — title-based (vendor IS the title)
  // ═══════════════════════════════════════════════════════════════

  it('title-based: "Netflix" title with body', async () => {
    const r = await extractWithAI(
      'NETFLIX You made a recurring payment for $15.99 with your credit card.', ['Leisure']);
    expect(r.isTransaction).toBe(true);
    expect(r.amount).toBe(15.99);
    expect(r.vendor).toBeTruthy();
    expect(r.suggestedCategory).toBe('Leisure');
  });

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

  it('returns null category for unknown vendors', async () => {
    const r = await extractWithAI(
      'Charged $99.00 at Zorgblatt Industries', ['Groceries', 'Leisure']);
    expect(r.isTransaction).toBe(true);
    // Unknown vendor — no confident guess
    expect(r.suggestedCategory).toBeNull();
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
});

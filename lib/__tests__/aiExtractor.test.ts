import { describe, it, expect } from 'vitest';
import { extractWithAI } from '../aiExtractor';

describe('extractWithAI (local extraction)', () => {
  // ── User's exact notification formats ──

  it('extracts FIZZ recurring payment', async () => {
    const result = await extractWithAI(
      'FIZZ (TX. INCL.) You made a recurring payment for $26.20 with your credit card.',
      ['Utilities', 'Groceries', 'Leisure'],
    );
    expect(result.isTransaction).toBe(true);
    expect(result.amount).toBe(26.20);
    expect(result.vendor).toBeTruthy();
    // FIZZ is a telecom → should map to Utilities
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
    // Disney Plus is entertainment → should map to Leisure
    expect(result.suggestedCategory).toBe('Leisure');
  });

  // ── Common notification formats ──

  it('extracts "Purchase of $X at VENDOR"', async () => {
    const result = await extractWithAI(
      'Wealthsimple Purchase of $12.34 at Subway',
      ['Groceries', 'Leisure'],
    );
    expect(result.isTransaction).toBe(true);
    expect(result.amount).toBe(12.34);
    expect(result.vendor).not.toBeNull();
  });

  it('extracts "You spent $X at VENDOR"', async () => {
    const result = await extractWithAI(
      'BMO You spent $45.00 at Shell Gas Station on your credit card.',
      ['Transport', 'Groceries'],
    );
    expect(result.isTransaction).toBe(true);
    expect(result.amount).toBe(45.00);
    expect(result.suggestedCategory).toBe('Transport');
  });

  it('extracts "charged $X at VENDOR"', async () => {
    const result = await extractWithAI(
      'Scotiabank Charged $87.42 at Whole Foods',
      ['Groceries', 'Leisure'],
    );
    expect(result.isTransaction).toBe(true);
    expect(result.amount).toBe(87.42);
    expect(result.suggestedCategory).toBe('Groceries');
  });

  it('extracts Netflix subscription', async () => {
    const result = await extractWithAI(
      'NETFLIX You made a recurring payment for $15.99 with your credit card.',
      ['Utilities', 'Leisure', 'Services'],
    );
    expect(result.isTransaction).toBe(true);
    expect(result.amount).toBe(15.99);
    expect(result.vendor).toBeTruthy();
    expect(result.suggestedCategory).toBe('Leisure');
  });

  // ── Rejection cases ──

  it('rejects OTP notifications', async () => {
    const result = await extractWithAI(
      'BMO Your verification code is 123456',
      ['Groceries'],
    );
    expect(result.isTransaction).toBe(false);
  });

  it('rejects balance alerts', async () => {
    const result = await extractWithAI(
      'Your account balance is $1,234.56',
      ['Groceries'],
    );
    expect(result.isTransaction).toBe(false);
  });

  it('rejects login notifications', async () => {
    const result = await extractWithAI(
      'New sign in to your account from Chrome on Windows',
      ['Groceries'],
    );
    expect(result.isTransaction).toBe(false);
  });

  it('rejects notifications without dollar amounts', async () => {
    const result = await extractWithAI(
      'Your package has been delivered',
      ['Groceries'],
    );
    expect(result.isTransaction).toBe(false);
    expect(result.rejectionReason).toContain('No dollar amount');
  });

  // ── Category guessing ──

  it('guesses Groceries for grocery stores', async () => {
    const result = await extractWithAI(
      'Payment of $62.15 at Loblaws',
      ['Groceries', 'Leisure', 'Transport'],
    );
    expect(result.isTransaction).toBe(true);
    expect(result.suggestedCategory).toBe('Groceries');
  });

  it('guesses Transport for gas stations', async () => {
    const result = await extractWithAI(
      'Payment of $55.00 at Petro-Canada',
      ['Groceries', 'Leisure', 'Transport'],
    );
    expect(result.isTransaction).toBe(true);
    expect(result.suggestedCategory).toBe('Transport');
  });

  it('guesses Utilities for telecom', async () => {
    const result = await extractWithAI(
      'BELL You made a payment of $85.00',
      ['Utilities', 'Groceries', 'Leisure'],
    );
    expect(result.isTransaction).toBe(true);
    expect(result.suggestedCategory).toBe('Utilities');
  });

  it('guesses Services for recurring payments', async () => {
    const result = await extractWithAI(
      'SOME UNKNOWN VENDOR Your recurring payment of $9.99',
      ['Services', 'Groceries', 'Leisure'],
    );
    expect(result.isTransaction).toBe(true);
    // "recurring payment" maps to Services
    expect(result.suggestedCategory).toBe('Services');
  });

  // ── Vendor name cleaning ──

  it('cleans store numbers from vendor names', async () => {
    const result = await extractWithAI(
      'Payment of $5.50 at Subway#327',
      ['Groceries', 'Leisure'],
    );
    expect(result.isTransaction).toBe(true);
    expect(result.vendor).not.toContain('#327');
  });

  // ── Amount edge cases ──

  it('handles amounts with commas', async () => {
    const result = await extractWithAI(
      'Payment of $1,234.56 at Best Buy',
      ['Leisure'],
    );
    expect(result.isTransaction).toBe(true);
    expect(result.amount).toBe(1234.56);
  });
});

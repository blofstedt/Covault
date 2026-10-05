import { describe, expect, it } from 'vitest';
import {
  findNotificationDuplicate,
  findEmailCaptureForBank,
  findUnpairedBankCaptureForEmail,
  matchesCapturedVendor,
} from '../notificationDuplicates';
import { withCaptureMarker, withEmailPairedMarker } from '../captureChannel';

const purchase = {
  vendor: 'Intact Insurance',
  aliases: ['Intact'],
  amount: 477.46,
  date: '2026-09-24',
};

const transaction = (overrides: Partial<{
  id: string;
  vendor: string | null;
  amount: number | string;
  date: string;
}> = {}) => ({
  id: 'old-charge',
  vendor: 'Intact Insurance',
  amount: 477.45,
  date: '2026-09-23',
  ...overrides,
});

describe('notification duplicate decisions', () => {
  it('hard-skips a near-exact same-day report from the same merchant', () => {
    const result = findNotificationDuplicate(
      [transaction({ date: purchase.date })],
      purchase,
    );

    expect(result).toEqual({ kind: 'hard', transaction: transaction({ date: purchase.date }) });
  });

  it('keeps a nearby repeat visible as a soft duplicate', () => {
    const existing = transaction();

    expect(findNotificationDuplicate([existing], purchase)).toEqual({
      kind: 'soft',
      transaction: existing,
    });
  });

  it('uses a merchant alias when the saved row uses another known name', () => {
    const existing = transaction({ vendor: 'Intact' });

    expect(findNotificationDuplicate([existing], purchase)).toEqual({
      kind: 'soft',
      transaction: existing,
    });
  });

  it('chooses the closest amount when the merchant has several nearby rows', () => {
    const farther = transaction({ id: 'farther', amount: 300 });
    const closer = transaction({ id: 'closer', amount: 477.5 });

    expect(findNotificationDuplicate([farther, closer], purchase)).toEqual({
      kind: 'soft',
      transaction: closer,
    });
  });

  it('does not treat another merchant as a duplicate just because the amount matches', () => {
    expect(findNotificationDuplicate(
      [transaction({ vendor: 'Netflix', amount: purchase.amount, date: purchase.date })],
      purchase,
    )).toEqual({ kind: 'none' });
  });

  it('does not hard-skip an exact repeat on another day', () => {
    const existing = transaction({ amount: purchase.amount });

    expect(findNotificationDuplicate([existing], purchase)).toEqual({
      kind: 'soft',
      transaction: existing,
    });
  });

  it('keeps the one-cent boundary outside the hard-match tolerance', () => {
    const smallPurchase = { ...purchase, amount: 0.5 };
    const existing = transaction({ amount: 0.49, date: purchase.date });

    expect(findNotificationDuplicate([existing], smallPurchase)).toEqual({
      kind: 'soft',
      transaction: existing,
    });
  });

  it('compares normalized merchant names and aliases consistently', () => {
    expect(matchesCapturedVendor('INTACT INSURANCE (TX. INCL.)', purchase.vendor, purchase.aliases)).toBe(true);
    expect(matchesCapturedVendor('Intact Insurance Group', 'Insurance Group', [])).toBe(true);
    expect(matchesCapturedVendor('Netflix', purchase.vendor, purchase.aliases)).toBe(false);
    expect(matchesCapturedVendor('', purchase.vendor, purchase.aliases)).toBe(false);
  });
});

describe('email-to-bank duplicate selection', () => {
  const emailPurchase = {
    vendor: 'Loblaws',
    amount: 42.11,
    date: '2026-09-24',
  };

  const bankCapture = (
    id: string,
    amount: number,
    date: string,
    vendor = 'LOBLAWS',
  ) => ({
    id,
    vendor,
    amount,
    date,
    source: 'notification',
    raw_notification: withCaptureMarker('bank alert', {
      channel: 'bank',
      packageName: 'com.example.bank',
      notifiedAt: Date.parse(`${date}T12:00:00Z`),
    }),
  });

  it('chooses the closest amount, then the closest date', () => {
    const fartherAmount = bankCapture('farther-amount', 42.10, '2026-09-24');
    const fartherDate = bankCapture('farther-date', 42.11, '2026-09-21');
    const closest = bankCapture('closest', 42.11, '2026-09-23');

    expect(findUnpairedBankCaptureForEmail(
      [fartherAmount, fartherDate, closest],
      emailPurchase,
    )).toBe(closest);
  });

  it('does not match another email, a typed purchase, a different merchant, a refund, or an old charge', () => {
    const emailRow = {
      ...bankCapture('email', 42.11, '2026-09-24'),
      raw_notification: withCaptureMarker('email alert', { channel: 'email' }),
    };
    const typedRow = {
      ...bankCapture('typed', 42.11, '2026-09-24'),
      source: 'manual',
      raw_notification: null,
    };

    expect(findUnpairedBankCaptureForEmail([
      emailRow,
      typedRow,
      bankCapture('other-merchant', 42.11, '2026-09-24', 'NETFLIX'),
      bankCapture('refund', -42.11, '2026-09-24'),
      bankCapture('old', 42.11, '2026-09-28'),
    ], emailPurchase)).toBeUndefined();
  });

  it('does not let a second email consume the same bank row', () => {
    const firstBankCapture = bankCapture('bank', 42.11, '2026-09-24');

    expect(findUnpairedBankCaptureForEmail([firstBankCapture], emailPurchase)).toBe(firstBankCapture);
    expect(findUnpairedBankCaptureForEmail([{
      ...firstBankCapture,
      raw_notification: withEmailPairedMarker(firstBankCapture.raw_notification),
    }], emailPurchase)).toBeUndefined();
  });
});

describe('bank-to-email duplicate selection', () => {
  const bankPurchase = {
    vendor: 'Loblaws #1234',
    amount: 42.11,
    date: '2026-09-24',
  };

  const emailCapture = (id: string, amount: number, date: string, vendor = 'LOBLAWS') => ({
    id,
    vendor,
    amount,
    date,
    raw_notification: withCaptureMarker('email alert', { channel: 'email' }),
  });

  it('selects the closest matching email row for the bank alert to upgrade', () => {
    const farther = emailCapture('farther', 42.10, '2026-09-24');
    const closest = emailCapture('closest', 42.11, '2026-09-22');

    expect(findEmailCaptureForBank([farther, closest], bankPurchase)).toBe(closest);
  });

  it('does not select bank, manual, unrelated, refunded, or old rows', () => {
    const bankCapture = {
      ...emailCapture('bank', 42.11, '2026-09-24'),
      raw_notification: withCaptureMarker('bank alert', { channel: 'bank' }),
    };
    const manualRow = {
      ...emailCapture('manual', 42.11, '2026-09-24'),
      raw_notification: null,
    };

    expect(findEmailCaptureForBank([
      bankCapture,
      manualRow,
      emailCapture('other-merchant', 42.11, '2026-09-24', 'NETFLIX'),
      emailCapture('refund', -42.11, '2026-09-24'),
      emailCapture('old', 42.11, '2026-09-28'),
    ], bankPurchase)).toBeUndefined();
  });
});

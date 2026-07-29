import { describe, it, expect } from 'vitest';
import { parseNotificationText } from '../deviceTransactionParser';

/**
 * BMO words a COMPLETED purchase as "was approved at <vendor>". 'approved' used
 * to be a weak GO phrase, which classified those as pre-authorization holds and
 * rejected them. Holds never settle into a capture, so BMO transactions were
 * silently lost.
 */
describe('completed purchases worded as "approved"', () => {
  it.each([
    'BMO A transaction of $18.75 was approved at MCDONALDS.',
    'BMO Your purchase of $42.10 at SOBEYS was approved.',
    'A credit card transaction of $112.34 was approved at COSTCO WHOLESALE.',
  ])('captures %s', (text) => {
    const r = parseNotificationText(text);
    expect(r.isOutgoing).toBe(true);
    expect(r.amount).toBeGreaterThan(0);
  });

  it('still rejects a bare authorization as a hold', () => {
    // Gas stations pre-authorize; 'authorized' alone remains a weak signal.
    const r = parseNotificationText('Authorized $50.00 at PETRO CANADA');
    expect(r.isOutgoing).toBe(false);
    expect(r.isPreAuth).toBe(true);
  });

  it.each([
    'Authorization hold of $100.00 approved at MARRIOTT HOTEL',
    'Pending transaction: $75.00 approved at HERTZ',
    'Temporary hold of $200.00 approved at AVIS',
  ])('lets an explicit hold phrase win over "approved" — %s', (text) => {
    const r = parseNotificationText(text);
    expect(r.isOutgoing).toBe(false);
    expect(r.isPreAuth).toBe(true);
  });

  it('captures once a hold settles', () => {
    const r = parseNotificationText('Your pre-authorization for $60.00 at ESSO has posted');
    expect(r.isOutgoing).toBe(true);
    expect(r.amount).toBe(60);
  });

  it('leaves ordinary BMO wordings alone', () => {
    for (const text of [
      'BMO You spent $12.45 at TIM HORTONS',
      'BMO A debit card transaction of $45.20 was made at TIM HORTONS.',
      'BMO $99.99 was posted to your Mastercard at AMAZON.CA',
    ]) {
      expect(parseNotificationText(text).isOutgoing).toBe(true);
    }
  });
});

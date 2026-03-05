import { describe, it, expect } from 'vitest';
import { findAllAmounts, parseNotificationText, pickAmount } from '../deviceTransactionParser';

describe('deviceTransactionParser', () => {
  it('ignores OTP/security notifications', () => {
    const result = parseNotificationText('Your verification code is 123456 for login.');
    expect(result.isOutgoing).toBe(false);
  });

  it('picks spend amount over balance amount', () => {
    const text = 'You spent $12.34 at Walmart. Available balance $923.12';
    const candidates = findAllAmounts(text);
    const picked = pickAmount(candidates, text.toLowerCase());
    expect(picked).toBe(12.34);
  });

  it('extracts vendor and recurrence', () => {
    const result = parseNotificationText('Payment to netflix monthly for $22.99');
    expect(result.isOutgoing).toBe(true);
    expect(result.vendorDisplay).toBe('Netflix');
    expect(result.recurrence).toBe('Monthly');
  });

  it('parses transfer out notifications', () => {
    const result = parseNotificationText('Interac e-transfer sent to Alex for CAD 40.00');
    expect(result.isOutgoing).toBe(true);
    expect(result.amount).toBe(40);
    expect(result.vendorDisplay).toBe('Alex');
  });
});

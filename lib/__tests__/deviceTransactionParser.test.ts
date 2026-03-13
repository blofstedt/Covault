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

  it('parses spent notifications with store suffix ids (real-world case)', () => {
    const result = parseNotificationText('TIM HORTONS #5028 You spent $7.34 with your credit card.');
    expect(result.isOutgoing).toBe(true);
    expect(result.amount).toBe(7.34);
    expect(result.vendorDisplay).toBe('Tim Hortons');
  });

  it('ignores store number ids as amount candidates', () => {
    const text = 'TIM HORTONS #5028 You spent $7.34 with your credit card.';
    const candidates = findAllAmounts(text);
    const picked = pickAmount(candidates, text.toLowerCase());
    expect(picked).toBe(7.34);
  });

  it('supports outgoing cost wording', () => {
    const result = parseNotificationText('This transaction costs $19.99 at Uber Eats');
    expect(result.isOutgoing).toBe(true);
    expect(result.amount).toBe(19.99);
    expect(result.vendorDisplay).toBe('Uber Eats');
  });

  it('accepts one-time purchase wording as outgoing spend', () => {
    const result = parseNotificationText('One-time purchase at Steam for $35.00');
    expect(result.isOutgoing).toBe(true);
    expect(result.amount).toBe(35);
    expect(result.vendorDisplay).toBe('Steam');
  });

});

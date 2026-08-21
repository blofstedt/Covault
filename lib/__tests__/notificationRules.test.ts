import { describe, it, expect } from 'vitest';
import { matchesRule, type NotificationRule } from '../notificationRules';

const rule = (overrides: Partial<NotificationRule> = {}): NotificationRule => ({
  id: 'rule-id',
  user_id: 'user-1',
  pattern: 'Subscription Panic · $200',
  pattern_type: 'exact',
  use_count: 0,
  last_used_at: null,
  created_at: '2026-07-19T00:00:00.000Z',
  ...overrides,
});

describe('matchesRule', () => {
  it('matches exact text', () => {
    const r = rule({ pattern: 'Market alert · Subscription Panic', pattern_type: 'exact' });
    expect(matchesRule('Market alert · Subscription Panic', r)).toBe(true);
  });

  it('rejects when exact text differs', () => {
    const r = rule({ pattern: 'Market alert · Subscription Panic', pattern_type: 'exact' });
    expect(matchesRule('Market alert · Subscription Hope', r)).toBe(false);
  });

  it('treats the same alert in different casing as the same alert', () => {
    // The raw comparison is still case-sensitive, but a rule is now ALSO
    // matched on the alert's shape, and shapes are compared in lowercase. A
    // bank that changes the casing of its own alert is not sending a different
    // notification, and a rule that stopped working because of it was the same
    // dead rule as one that stopped working because the amount changed.
    const r = rule({ pattern: 'Market Alert · Subscription Panic', pattern_type: 'exact' });
    expect(matchesRule('market alert · subscription panic', r)).toBe(true);
    // A different alert is still a different alert.
    expect(matchesRule('Market Alert · Something Else', r)).toBe(false);
  });

  it('matches contains substring (case-insensitive)', () => {
    const r = rule({ pattern: 'subscription panic', pattern_type: 'contains' });
    expect(matchesRule('Market alert · Subscription Panic · $200', r)).toBe(true);
  });

  it('contains matches across casing', () => {
    const r = rule({ pattern: 'SUBSCRIPTION', pattern_type: 'contains' });
    expect(matchesRule('your subscription has been renewed', r)).toBe(true);
  });

  it('rejects contains when substring is missing', () => {
    const r = rule({ pattern: 'subscription', pattern_type: 'contains' });
    expect(matchesRule('a charge of $50', r)).toBe(false);
  });

  it('trims whitespace from both sides', () => {
    const r = rule({ pattern: 'alert', pattern_type: 'contains' });
    expect(matchesRule('   market alert!  ', r)).toBe(true);
  });

  it('returns false for empty pattern', () => {
    const r = rule({ pattern: '', pattern_type: 'contains' });
    expect(matchesRule('anything', r)).toBe(false);
  });

  it('returns false for empty input', () => {
    const r = rule({ pattern: 'x', pattern_type: 'contains' });
    expect(matchesRule('', r)).toBe(false);
  });

  it('returns false for whitespace-only pattern', () => {
    const r = rule({ pattern: '   ', pattern_type: 'contains' });
    expect(matchesRule('anything', r)).toBe(false);
  });

  it('defaults missing pattern_type to exact semantics', () => {
    const r = { ...rule(), pattern_type: undefined as any };
    expect(matchesRule('Subscription Panic · $200', r)).toBe(true);
    // $300 now matches too, and that is the point: the rule was created from an
    // alert whose own amount was in it, so under the old comparison it could
    // never fire again. The words still have to be the same ones.
    expect(matchesRule('Subscription Panic · $300', r)).toBe(true);
    expect(matchesRule('Something Else · $300', r)).toBe(false);
  });
});

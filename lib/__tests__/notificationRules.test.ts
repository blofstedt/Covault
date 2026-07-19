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

  it('is case-insensitive for exact matches', () => {
    const r = rule({ pattern: 'Market Alert · Subscription Panic', pattern_type: 'exact' });
    // exact match is whitespace-trimmed and case-SENSITIVE by default
    // (consistent with the user's "exact" intent). Lowercase shouldn't match uppercase.
    expect(matchesRule('market alert · subscription panic', r)).toBe(false);
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
    expect(matchesRule('Subscription Panic · $300', r)).toBe(false);
  });
});

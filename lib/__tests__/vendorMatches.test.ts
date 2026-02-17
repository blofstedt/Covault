import { describe, it, expect, vi } from 'vitest';

// Mock dependencies that require browser/native APIs
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
  registerPlugin: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
  supabaseUrl: 'https://mock.supabase.co',
  supabaseAnonKey: 'mock-anon-key',
}));

import { vendorMatches } from '../notificationProcessor';

describe('vendorMatches', () => {
  it('exact case-insensitive match', () => {
    expect(vendorMatches('McDonald\'s', 'mcdonald\'s')).toBe(true);
  });

  it('keyword match — existing vendor contains word from new vendor', () => {
    expect(vendorMatches('Tim Hortons', 'Hortons')).toBe(true);
  });

  it('keyword match — new vendor contains word from existing', () => {
    expect(vendorMatches('Costco', 'Costco Wholesale')).toBe(true);
  });

  it('no match — completely different vendors', () => {
    expect(vendorMatches('Walmart', 'Starbucks')).toBe(false);
  });

  it('ignores short words (< 3 chars) for keyword matching', () => {
    // "at" is too short to be a keyword match
    expect(vendorMatches('at', 'at')).toBe(true); // exact match still works
    // "A&W" as a word is 3 chars, so it DOES match as a keyword
    expect(vendorMatches('A&W', 'Walmart at A&W')).toBe(true);
    // "Go" is only 2 chars — should not match as keyword
    expect(vendorMatches('Go', 'Let\'s Go Shopping')).toBe(false);
  });

  it('both null returns true', () => {
    expect(vendorMatches(null, null)).toBe(true);
  });

  it('one null returns false', () => {
    expect(vendorMatches('Costco', null)).toBe(false);
    expect(vendorMatches(null, 'Costco')).toBe(false);
  });

  it('handles BMO Bank of Montreal keyword matching', () => {
    expect(vendorMatches('BMO', 'Bank of Montreal')).toBe(false); // "BMO" is only 3 chars, but not in "Bank of Montreal"
    expect(vendorMatches('BMO Financial', 'Financial Services')).toBe(true); // "Financial" keyword match
  });

  it('handles multi-word vendor names', () => {
    expect(vendorMatches('Tim Hortons #123', 'Tim Hortons')).toBe(true);
    expect(vendorMatches('Uber Eats', 'Uber Eats Delivery')).toBe(true);
  });
});

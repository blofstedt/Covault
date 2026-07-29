import { describe, it, expect } from 'vitest';
import { cleanVendorInput, formatVendorName } from '../formatVendorName';

/**
 * A manual rename must survive exactly as typed. formatVendorName lowercases
 * everything after the first letter, so "A&W" became "A&w" — a rename that only
 * changed capitalization saved the value already stored and looked like the
 * update silently failed.
 */
describe('cleanVendorInput', () => {
  it.each(['A&W', 'IKEA', 'H&M', 'LCBO', "McDonald's", 'PayPal', 'iTunes', '7-ELEVEN'])(
    'preserves deliberate capitalization in %s',
    (name) => {
      expect(cleanVendorInput(name)).toBe(name);
    },
  );

  it('is what formatVendorName would have destroyed', () => {
    expect(formatVendorName('A&W')).toBe('A&w');
    expect(cleanVendorInput('A&W')).toBe('A&W');
  });

  it('still trims and collapses whitespace', () => {
    expect(cleanVendorInput('  Tim   Hortons  ')).toBe('Tim Hortons');
  });

  it('handles empty input', () => {
    expect(cleanVendorInput('')).toBe('');
    expect(cleanVendorInput('   ')).toBe('');
  });

  it('detects a capitalization-only rename as a change', () => {
    // The comparison that decides whether to write a vendor override.
    expect(cleanVendorInput('A&W') !== cleanVendorInput('A&w')).toBe(true);
    expect(formatVendorName('A&W') !== formatVendorName('A&w')).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import {
  scoreVendorMatch,
  shouldAutoAccept,
  toMatchKey,
  AUTO_ACCEPT_MIN_CONFIDENCE,
} from '../vendorMatchConfidence';

/**
 * This score decides whether a transaction is filed to a budget without the
 * user ever seeing it. A false positive is a charge silently categorised
 * wrong — no review step, no badge, nothing to notice. So the tests below lean
 * hard on the cases that should NOT clear the bar.
 */

describe('toMatchKey', () => {
  it('reduces a vendor to the form the overrides table matches on', () => {
    expect(toMatchKey('TIM HORTONS #4471')).toBe('timhortons4471');
    expect(toMatchKey("McDonald's")).toBe('mcdonalds');
  });

  it('is safe on empty input', () => {
    expect(toMatchKey(null)).toBe('');
    expect(toMatchKey(undefined)).toBe('');
    expect(toMatchKey('!!!')).toBe('');
  });
});

describe('scoreVendorMatch', () => {
  it('scores an identical name 1', () => {
    expect(scoreVendorMatch('timhortons', 'timhortons', 'exact')).toBe(1);
  });

  it('scores an exact rule that is not equal as 0', () => {
    expect(scoreVendorMatch('timhortons4471', 'timhortons', 'exact')).toBe(0);
  });

  it('scores a prefix rule by how much of the name it explains', () => {
    // "timhortons" out of "timhortons4471" — 10/14.
    expect(scoreVendorMatch('timhortons4471', 'timhortons', 'prefix')).toBeCloseTo(10 / 14);
  });

  it('keeps a short rule against a long vendor well below the threshold', () => {
    // The case the whole design exists for. A rule the user wrote as "tim"
    // matches "TIM HORTONS DOWNTOWN" under `contains`, but explains almost
    // none of it — auto-filing on that would be guessing.
    const score = scoreVendorMatch('timhortonsdowntown', 'tim', 'contains');
    expect(score).toBeLessThan(AUTO_ACCEPT_MIN_CONFIDENCE);
  });

  it('returns 0 when the rule does not actually match', () => {
    expect(scoreVendorMatch('walmart', 'costco', 'contains')).toBe(0);
    expect(scoreVendorMatch('walmart', 'mart', 'prefix')).toBe(0);
  });

  it('returns 0 on empty input rather than dividing by zero', () => {
    expect(scoreVendorMatch('', 'timhortons', 'exact')).toBe(0);
    expect(scoreVendorMatch('timhortons', '', 'exact')).toBe(0);
  });

  it('returns 0 for an unrecognised match type', () => {
    // Defaulting an unknown mode to "matches" would auto-file on a rule shape
    // this code has never seen.
    expect(scoreVendorMatch('timhortons4471', 'timhortons', 'regex' as never)).toBe(0);
  });

  it('treats a missing match type as exact', () => {
    expect(scoreVendorMatch('timhortons', 'timhortons', null)).toBe(1);
    expect(scoreVendorMatch('timhortons4471', 'timhortons', undefined)).toBe(0);
  });

  it('never exceeds 1', () => {
    // A match key longer than the vendor cannot be contained in it, so this is
    // structurally impossible — assert it anyway, since a score above 1 would
    // sail past every threshold check.
    expect(scoreVendorMatch('abc', 'abcdef', 'contains')).toBe(0);
  });

  it('clears the threshold only for a near-complete match', () => {
    // "starbucks" in "starbucks01" is 9/11 — close, but not 90%.
    expect(scoreVendorMatch('starbucks01', 'starbucks', 'prefix')).toBeLessThan(AUTO_ACCEPT_MIN_CONFIDENCE);
    // "starbucks" in "starbucks1" is 9/10 — exactly at the bar.
    expect(scoreVendorMatch('starbucks1', 'starbucks', 'prefix')).toBeGreaterThanOrEqual(AUTO_ACCEPT_MIN_CONFIDENCE);
  });
});

describe('shouldAutoAccept', () => {
  it('files when everything lines up', () => {
    expect(shouldAutoAccept({ enabled: true, confidence: 1, hasCategory: true })).toBe(true);
  });

  it('never files when the setting is off', () => {
    expect(shouldAutoAccept({ enabled: false, confidence: 1, hasCategory: true })).toBe(false);
  });

  it('never files without a resolved category', () => {
    // There would be nowhere to file it to; "Other" is a fallback the user
    // should get the chance to correct.
    expect(shouldAutoAccept({ enabled: true, confidence: 1, hasCategory: false })).toBe(false);
  });

  it('sends anything below the threshold to review', () => {
    expect(shouldAutoAccept({ enabled: true, confidence: 0.89, hasCategory: true })).toBe(false);
  });

  it('accepts exactly at the threshold', () => {
    expect(shouldAutoAccept({
      enabled: true,
      confidence: AUTO_ACCEPT_MIN_CONFIDENCE,
      hasCategory: true,
    })).toBe(true);
  });

  it('sends a non-finite confidence to review', () => {
    // A NaN would otherwise fail every comparison silently; make the direction
    // of that failure explicit.
    expect(shouldAutoAccept({ enabled: true, confidence: NaN, hasCategory: true })).toBe(false);
  });

  it('sends a zero confidence to review', () => {
    // 0 is what the processor uses for "no rule matched" — a localStorage or
    // heuristic guess must never auto-file.
    expect(shouldAutoAccept({ enabled: true, confidence: 0, hasCategory: true })).toBe(false);
  });
});

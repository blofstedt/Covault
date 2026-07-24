import { describe, it, expect } from 'vitest';
import { classifyMatch } from '../hooks/useVendorMatcher';

describe('classifyMatch (capture-review triage)', () => {
  it('is exact when a deterministic override rule matches', () => {
    expect(classifyMatch({ hasOverrideMatch: true, confidence: null, hasBudget: true })).toBe('exact');
    // an override match wins even if a confidence score is also present
    expect(classifyMatch({ hasOverrideMatch: true, confidence: 0.9, hasBudget: true })).toBe('exact');
  });

  it('is ai when there is no rule but the pipeline assigned a confidence', () => {
    expect(classifyMatch({ hasOverrideMatch: false, confidence: 0.82, hasBudget: true })).toBe('ai');
    expect(classifyMatch({ hasOverrideMatch: false, confidence: 0, hasBudget: false })).toBe('ai');
  });

  it('is ai when a budget was assigned without a confidence score', () => {
    expect(classifyMatch({ hasOverrideMatch: false, confidence: null, hasBudget: true })).toBe('ai');
  });

  it('is unmatched when there is no rule, no confidence, and no budget', () => {
    expect(classifyMatch({ hasOverrideMatch: false, confidence: null, hasBudget: false })).toBe('unmatched');
    expect(classifyMatch({ hasOverrideMatch: false, confidence: undefined, hasBudget: false })).toBe('unmatched');
  });
});

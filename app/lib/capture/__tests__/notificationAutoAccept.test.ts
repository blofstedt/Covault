import { describe, expect, it } from 'vitest';
import { canAutoAcceptCapture } from '../notificationAutoAccept';

const eligibleCapture: Parameters<typeof canAutoAcceptCapture>[0] = {
  source: 'bank',
  optedIn: true,
  hasFuelHold: false,
  hasUncertainExtraction: false,
  hasPossibleDuplicate: false,
  hasForeignCurrency: false,
  matchConfidence: 0.95,
  hasCategory: true,
};

const reviewRequiredCases: Array<[
  string,
  Partial<Parameters<typeof canAutoAcceptCapture>[0]>,
]> = [
  ['email captures', { source: 'email' }],
  ['fuel holds', { hasFuelHold: true }],
  ['uncertain merchant reads', { hasUncertainExtraction: true }],
  ['possible duplicates', { hasPossibleDuplicate: true }],
  ['foreign-currency amounts', { hasForeignCurrency: true }],
  ['captures without opt-in', { optedIn: false }],
  ['captures without a category', { hasCategory: false }],
  ['weak vendor-rule matches', { matchConfidence: 0.89 }],
];

describe('automatic capture filing', () => {
  it('files a confident, categorized bank capture only after opt-in', () => {
    expect(canAutoAcceptCapture(eligibleCapture)).toBe(true);
  });

  it.each(reviewRequiredCases)('keeps %s in Review', (_reason, changes) => {
    expect(canAutoAcceptCapture({ ...eligibleCapture, ...changes })).toBe(false);
  });
});

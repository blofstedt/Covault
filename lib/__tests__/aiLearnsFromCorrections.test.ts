import { describe, it, expect } from 'vitest';
import { selectLearnedExamples, type LearnedVendorExample } from '../aiExtractor';

/**
 * The on-device model (flan-t5-small) cannot be fine-tuned, so "learning" means
 * showing it the user's own past decisions as few-shot precedent. Its context
 * window is small, so which examples get chosen matters more than how many.
 */
const corpus: LearnedVendorExample[] = [
  { vendor: 'Costco Gas', category: 'Transport' },
  { vendor: 'Airport Parking', category: 'Transport' },
  { vendor: 'Sobeys', category: 'Groceries' },
  { vendor: 'Netflix', category: 'Leisure' },
  { vendor: 'Tim Hortons', category: 'Leisure' },
  { vendor: 'Hydro One', category: 'Utilities' },
];

describe('selectLearnedExamples', () => {
  it('puts examples sharing a word with the notification first', () => {
    const picked = selectLearnedExamples('COSTCO GAS #142 You spent $60.00', corpus, 3);
    expect(picked[0].vendor).toBe('Costco Gas');
  });

  it('matches on a shared token, not just the whole name', () => {
    const picked = selectLearnedExamples('PARKING RAMP DOWNTOWN $12.00', corpus, 2);
    expect(picked.map((e) => e.vendor)).toContain('Airport Parking');
  });

  it('respects the limit so the prompt stays small', () => {
    expect(selectLearnedExamples('SOMETHING NEW $5.00', corpus, 3)).toHaveLength(3);
    expect(selectLearnedExamples('SOMETHING NEW $5.00', corpus, 0)).toHaveLength(0);
  });

  it('falls back to caller order (most recent first) when nothing is relevant', () => {
    const picked = selectLearnedExamples('UNRELATED MERCHANT $9.99', corpus, 2);
    expect(picked.map((e) => e.vendor)).toEqual(['Costco Gas', 'Airport Parking']);
  });

  it('never repeats a vendor', () => {
    const dupes: LearnedVendorExample[] = [
      { vendor: 'Sobeys', category: 'Groceries' },
      { vendor: 'sobeys', category: 'Other' },
      { vendor: 'Netflix', category: 'Leisure' },
    ];
    const picked = selectLearnedExamples('SOBEYS $30', dupes, 5);
    expect(picked).toHaveLength(2);
    // The most recent decision wins, so a changed mind beats an old habit.
    expect(picked[0].category).toBe('Groceries');
  });

  it('ignores incomplete entries', () => {
    const messy = [
      { vendor: '', category: 'Groceries' },
      { vendor: 'Sobeys', category: '' },
      { vendor: 'Netflix', category: 'Leisure' },
    ] as LearnedVendorExample[];
    expect(selectLearnedExamples('anything', messy, 5)).toEqual([
      { vendor: 'Netflix', category: 'Leisure' },
    ]);
  });

  it('handles an empty corpus', () => {
    expect(selectLearnedExamples('SOBEYS $30', [], 5)).toEqual([]);
  });

  it('ignores short noise tokens when scoring', () => {
    // "of"/"at" must not make everything look relevant.
    const picked = selectLearnedExamples('A transaction of $18.75 at SOBEYS', corpus, 1);
    expect(picked[0].vendor).toBe('Sobeys');
  });
});

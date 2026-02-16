import { describe, it, expect } from 'vitest';
import { getBudgetColor } from '../budgetColors';

describe('getBudgetColor', () => {
  it('returns indigo for housing', () => {
    const color = getBudgetColor('Housing', 0);
    expect(color.primary).toBe('#6366f1');
  });

  it('returns green for groceries', () => {
    const color = getBudgetColor('Groceries', 1);
    expect(color.primary).toBe('#22c55e');
  });

  it('returns amber for transport', () => {
    const color = getBudgetColor('Transport', 2);
    expect(color.primary).toBe('#f59e0b');
  });

  it('matches case-insensitively', () => {
    const color = getBudgetColor('HOUSING expenses', 0);
    expect(color.primary).toBe('#6366f1');
  });

  it('returns a fallback color for unknown categories', () => {
    const color = getBudgetColor('Pets', 0);
    expect(color.primary).toBe('#14b8a6'); // first fallback (teal)
  });

  it('cycles fallback palette by index', () => {
    const color = getBudgetColor('Custom', 1);
    expect(color.primary).toBe('#e11d48'); // second fallback (rose)
  });
});

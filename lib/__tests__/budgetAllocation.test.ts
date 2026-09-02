import { describe, expect, it } from 'vitest';
import {
  allocationTotal,
  allocationTotalWith,
  isAllowedLimitChange,
  remainingToAllocate,
} from '../budgetAllocation';

/**
 * The trap a new user starts inside.
 *
 * Every account begins with seven categories at $500 — $3,500 of plans nobody
 * made. The limits screen refused any save whose resulting total came out over
 * the monthly income, and looked only at that total, so somebody earning $3,000
 * was over the line before they touched anything AND could not come back down:
 * lowering Housing from $500 to $400 still leaves $3,400, still over, still
 * refused. The only escape the app offered was to claim a bigger income.
 */
const STARTER = [
  { id: 'budget:housing', totalLimit: 500 },
  { id: 'budget:groceries', totalLimit: 500 },
  { id: 'budget:transport', totalLimit: 500 },
  { id: 'budget:utilities', totalLimit: 500 },
  { id: 'budget:leisure', totalLimit: 500 },
  { id: 'budget:services', totalLimit: 500 },
  { id: 'budget:other', totalLimit: 500 },
];

const INCOME = 3000;

describe('what the month already has planned', () => {
  it('adds up the visible limits', () => {
    expect(allocationTotal(STARTER)).toBe(3500);
  });

  it('leaves out a category the user has put away', () => {
    expect(allocationTotal(STARTER, ['budget:leisure'])).toBe(3000);
  });

  it('leaves a hidden category out however large a figure is typed into it', () => {
    expect(
      allocationTotalWith(STARTER, ['budget:leisure'], 'budget:leisure', 9000),
    ).toBe(3000);
  });

  it('reports being over as a negative rather than refusing to say', () => {
    expect(remainingToAllocate(INCOME, allocationTotal(STARTER))).toBe(-500);
  });
});

describe('whether a limit change may be saved', () => {
  const previousTotal = allocationTotal(STARTER);

  it('lets an over-allocated user come back down, even while still over', () => {
    const nextTotal = allocationTotalWith(STARTER, [], 'budget:housing', 400);
    expect(nextTotal).toBe(3400);
    expect(nextTotal).toBeGreaterThan(INCOME);
    expect(isAllowedLimitChange({ previousTotal, nextTotal, income: INCOME })).toBe(true);
  });

  it('still refuses a change that pushes further past the income', () => {
    const nextTotal = allocationTotalWith(STARTER, [], 'budget:housing', 600);
    expect(isAllowedLimitChange({ previousTotal, nextTotal, income: INCOME })).toBe(false);
  });

  it('allows anything that fits inside the income', () => {
    const roomyIncome = 4000;
    const nextTotal = allocationTotalWith(STARTER, [], 'budget:housing', 900);
    expect(nextTotal).toBe(3900);
    expect(nextTotal).toBeLessThanOrEqual(roomyIncome);
    expect(isAllowedLimitChange({ previousTotal, nextTotal, income: roomyIncome })).toBe(true);
  });

  it('has nothing to refuse when no income has been set yet', () => {
    // Which is the state through most of the intro, and for anyone who skipped
    // the income step. There is no line to be over.
    expect(isAllowedLimitChange({ previousTotal, nextTotal: 99_999, income: 0 })).toBe(true);
  });
});

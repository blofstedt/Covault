/**
 * The categories the user turned off must not come back as choices.
 *
 * The eye in Budget Limits writes `Visible = false` on the budget row, which
 * `loadUserBudgets` reads into `settings.hiddenCategories`. The dashboard
 * honours it, the chart honours it — and the two places that let a transaction
 * be FILED did not, so every category the user had hidden was offered again in
 * the edit form ("all budget categories show up, regardless of what the user
 * has enabled"). These tests pin the rule in one function so both pickers read
 * it from the same place.
 */
import { describe, it, expect } from 'vitest';
import { selectableBudgets } from '../budgetVisibility';
import type { BudgetCategory } from '../../types';

const cat = (name: string): BudgetCategory => ({ id: `budget:${name.toLowerCase()}`, name, totalLimit: 100 });

const ALL = [cat('Housing'), cat('Groceries'), cat('Leisure'), cat('Services'), cat('Transport'), cat('Other')];

describe('selectableBudgets', () => {
  it('drops the categories the user has hidden', () => {
    const hidden = ['budget:leisure', 'budget:other'];
    const out = selectableBudgets(ALL, hidden);
    expect(out.map((b) => b.name)).toEqual(['Housing', 'Groceries', 'Services', 'Transport']);
  });

  it('offers everything when nothing is hidden', () => {
    expect(selectableBudgets(ALL, []).map((b) => b.name)).toEqual(ALL.map((b) => b.name));
  });

  it('shows the category a transaction is already filed under, even hidden', () => {
    // Hiding a category does not move the rows already filed to it. An edit form
    // that filtered that one out would open with nothing selected, and the user
    // could not see what the entry says.
    const out = selectableBudgets(ALL, ['budget:leisure'], ['budget:leisure']);
    expect(out.map((b) => b.name)).toContain('Leisure');
    expect(out).toHaveLength(ALL.length);
  });

  it('does not keep a category that merely has no id to keep', () => {
    const out = selectableBudgets(ALL, ['budget:leisure'], [null, undefined, '']);
    expect(out.map((b) => b.name)).not.toContain('Leisure');
  });

  it('ignores ids that are not in the list at all', () => {
    const out = selectableBudgets(ALL, ['budget:leisure'], ['budget:pets']);
    expect(out.map((b) => b.name)).not.toContain('Leisure');
    expect(out).toHaveLength(ALL.length - 1);
  });

  it('does not mutate its inputs', () => {
    const budgets = [...ALL];
    const hidden = ['budget:leisure'];
    selectableBudgets(budgets, hidden);
    expect(budgets).toHaveLength(ALL.length);
    expect(hidden).toEqual(['budget:leisure']);
  });

  it('hands back a plain array, safe to sort or slice', () => {
    const out = selectableBudgets(ALL, []);
    expect(Array.isArray(out)).toBe(true);
    out.push(cat('Pets'));
    expect(ALL).toHaveLength(6);
  });
});

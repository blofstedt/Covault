/**
 * The vials sit in a fixed order.
 *
 * `budgets` has no primary key and no sort column, and the app reads it with a
 * plain `select=*`. Postgres therefore returns heap order, which changes the
 * moment a row is UPDATEd — so editing one budget's limit moved that vial to
 * the bottom of the dashboard on the next load, for no reason the user could
 * see. These tests pin the order down in code instead.
 */
import { describe, it, expect } from 'vitest';
import { compareBudgets, sortBudgets } from '../budgetOrder';
import { SYSTEM_CATEGORIES } from '../../constants';

const shuffled = (names: string[]) => names.map((name) => ({ name, id: name }));

describe('sortBudgets', () => {
  it('puts the categories in the app\'s own order, whatever order they arrive in', () => {
    const out = sortBudgets(
      shuffled(['Other', 'Leisure', 'Housing', 'Services', 'Groceries', 'Utilities', 'Transport']),
    );
    expect(out.map((b) => b.name)).toEqual(SYSTEM_CATEGORIES.map((c) => c.name));
  });

  it('gives the same answer however the rows are shuffled', () => {
    // The point of the whole file: the database's row order must not reach the
    // screen.
    const a = sortBudgets(shuffled(['Utilities', 'Housing', 'Other', 'Groceries']));
    const b = sortBudgets(shuffled(['Other', 'Groceries', 'Utilities', 'Housing']));
    expect(a.map((x) => x.name)).toEqual(b.map((x) => x.name));
  });

  it('keeps Other last even when an unknown category is present', () => {
    const out = sortBudgets(shuffled(['Other', 'Pets', 'Groceries']));
    expect(out.map((b) => b.name)).toEqual(['Groceries', 'Pets', 'Other']);
  });

  it('sorts unknown categories alphabetically, not by arrival', () => {
    const out = sortBudgets(shuffled(['Zoo', 'Pets', 'Aardvark']));
    expect(out.map((b) => b.name)).toEqual(['Aardvark', 'Pets', 'Zoo']);
  });

  it('does not mutate the list it was given', () => {
    const input = shuffled(['Other', 'Housing']);
    sortBudgets(input);
    expect(input.map((b) => b.name)).toEqual(['Other', 'Housing']);
  });

  it('is case- and whitespace-insensitive about the names', () => {
    const out = sortBudgets(shuffled([' other ', 'GROCERIES', 'housing']));
    expect(out.map((b) => b.name.trim().toLowerCase())).toEqual([
      'housing',
      'groceries',
      'other',
    ]);
  });
});

describe('compareBudgets', () => {
  it('is a total order, so sort() cannot depend on the input order', () => {
    const names = [...SYSTEM_CATEGORIES.map((c) => c.name), 'Pets'];
    for (const a of names) {
      for (const b of names) {
        const forward = compareBudgets({ name: a }, { name: b });
        const backward = compareBudgets({ name: b }, { name: a });
        if (a === b) expect(forward).toBe(0);
        else expect(Math.sign(forward)).toBe(-Math.sign(backward));
      }
    }
  });
});

/**
 * The Discretionary Shield actually takes a chunk out of Leisure.
 *
 * It shipped inert: the toggle saved, the vial knew how to draw a deduction,
 * and the dashboard passed a literal `0` between them — so switching the
 * shield on changed nothing on screen, which is exactly what a working feature
 * with nothing to absorb looks like. These tests pin the amount down, and pin
 * the two rules that keep it explainable: every dollar it removes from Leisure
 * is a dollar another vial ON SCREEN is over by, and the shield never rewrites
 * that other vial to look as though it came in under its limit.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  computeShieldedOverflow,
  computeBudgetTotals,
  isLeisureBudget,
} from '../discretionaryShield';
import type { BudgetCategory, Transaction } from '../../types';

const LEISURE = '55555555-5555-5555-5555-555555555555';
const OTHER = '66666666-6666-6666-6666-666666666666';
const GROCERIES = '22222222-2222-2222-2222-222222222222';

const budgets = (overrides: Partial<Record<string, number>> = {}): BudgetCategory[] => [
  { id: GROCERIES, name: 'Groceries', totalLimit: overrides[GROCERIES] ?? 500 },
  { id: LEISURE, name: 'Leisure', totalLimit: overrides[LEISURE] ?? 500 },
  { id: OTHER, name: 'Other', totalLimit: overrides[OTHER] ?? 500 },
];

let seq = 0;
const tx = (budgetId: string, amount: number, extra: Partial<Transaction> = {}): Transaction =>
  ({
    id: `tx-${++seq}`,
    budget_id: budgetId,
    amount,
    vendor: `Vendor ${seq}`,
    date: '2026-09-03',
    label: 'Manual',
    ...extra,
  }) as Transaction;

describe('computeShieldedOverflow', () => {
  it('is zero when nothing is over its limit', () => {
    const rows = [tx(OTHER, 100), tx(GROCERIES, 250), tx(LEISURE, 400)];
    expect(computeShieldedOverflow(budgets(), rows)).toBe(0);
  });

  it('absorbs the amount another budget is over by', () => {
    // Other: $580 against a $500 limit.
    const rows = [tx(OTHER, 500), tx(OTHER, 80)];
    expect(computeShieldedOverflow(budgets(), rows)).toBe(80);
  });

  it('adds up every overspent budget, not just the first', () => {
    const rows = [tx(OTHER, 580), tx(GROCERIES, 545)];
    expect(computeShieldedOverflow(budgets(), rows)).toBe(125);
  });

  it('does not let an underspent budget cancel out an overspent one', () => {
    // Groceries came in $400 under. That surplus is not the shield's to spend
    // — the user is still over on Other, and the Leisure vault is what covers
    // it.
    const rows = [tx(OTHER, 580), tx(GROCERIES, 100)];
    expect(computeShieldedOverflow(budgets(), rows)).toBe(80);
  });

  it('never absorbs Leisure\'s own overspending', () => {
    // Otherwise the vault would be shielding itself: the deduction would grow
    // the overspend that produced it.
    const rows = [tx(LEISURE, 900)];
    expect(computeShieldedOverflow(budgets(), rows)).toBe(0);
  });

  it('counts this month\'s remaining recurring charges, like the vial does', () => {
    // The vial shows spent + projected against the limit, so a budget pushed
    // over by a subscription that has not landed yet is over on screen — and
    // has to be over here too, or the two disagree.
    const rows = [tx(OTHER, 450), tx(OTHER, 90, { is_projected: true })];
    expect(computeShieldedOverflow(budgets(), rows)).toBe(40);
  });

  it('leaves hidden categories out', () => {
    // A hidden category has no vial. Counting it would take a chunk out of
    // Leisure that nothing on screen accounts for — indistinguishable from the
    // bug this file exists to prevent.
    const rows = [tx(OTHER, 580), tx(GROCERIES, 545)];
    expect(
      computeShieldedOverflow(budgets(), rows, { hiddenCategories: [GROCERIES] }),
    ).toBe(80);
  });

  it('follows the refund, so a returned purchase stops being shielded', () => {
    const spend = tx(OTHER, 580, { vendor: 'Canadian Tire', date: '2026-09-02' });
    const refund = tx(OTHER, -580, { vendor: 'Canadian Tire', date: '2026-09-04' });
    expect(computeShieldedOverflow(budgets(), [spend, refund])).toBe(0);
  });

  it('reports whole cents rather than floating-point dust', () => {
    const rows = [tx(OTHER, 500.1), tx(GROCERIES, 500.2)];
    expect(computeShieldedOverflow(budgets(), rows)).toBe(0.3);
  });

  it('is zero before the budgets have loaded', () => {
    expect(computeShieldedOverflow([], [tx(OTHER, 900)])).toBe(0);
  });
});

describe('computeBudgetTotals', () => {
  it('is the arithmetic the vial itself draws with', () => {
    const rows = [tx(OTHER, 120), tx(OTHER, 80, { is_projected: true })];
    const totals = computeBudgetTotals(OTHER, rows);
    expect(totals.spent).toBe(120);
    expect(totals.projected).toBe(80);
  });

  it('keeps refunds out of the list of rows to show', () => {
    const spend = tx(OTHER, 60, { vendor: 'Indigo', date: '2026-09-02' });
    const refund = tx(OTHER, -60, { vendor: 'Indigo', date: '2026-09-05' });
    const totals = computeBudgetTotals(OTHER, [spend, refund]);
    expect(totals.visibleTransactions.map((t) => t.id)).toEqual([spend.id]);
    expect(totals.refundedExpenseIds.has(spend.id)).toBe(true);
    // Carried over from BudgetSection unchanged, and pinned here so this
    // refactor provably moved the arithmetic without altering it: a MATCHED
    // refund currently counts twice — the expense is dropped from the total
    // AND the refund's negative amount is subtracted — so the vial reads -$60
    // rather than $0. That is a separate, pre-existing question from the
    // shield, deliberately not changed here (it would move every vial's
    // numbers). Whoever fixes it should update this line.
    expect(totals.spent).toBe(-60);
  });
});

describe('isLeisureBudget', () => {
  it('matches on the name, because the id is not stable', () => {
    // A budget loaded from the DB is keyed `budget:<name>`; the starter
    // constants carry fixed UUIDs. Only the name survives both.
    expect(isLeisureBudget({ name: 'Leisure' })).toBe(true);
    expect(isLeisureBudget({ name: 'leisure' })).toBe(true);
    expect(isLeisureBudget({ name: 'Other' })).toBe(false);
    expect(isLeisureBudget({ name: undefined })).toBe(false);
  });
});

describe('the wiring between the toggle and the vial', () => {
  const read = (relative: string) =>
    readFileSync(join(__dirname, '..', '..', relative), 'utf8');

  it('passes a real figure down, not the literal 0 it shipped with', () => {
    const dashboard = read('components/Dashboard.tsx');
    expect(dashboard).toContain('computeShieldedOverflow');
    expect(dashboard).not.toContain('leisureAdjustments={0}');
  });

  it('computes nothing while the shield is switched off', () => {
    const dashboard = read('components/Dashboard.tsx');
    expect(dashboard).toMatch(/if \(!state\.settings\.useLeisureAsBuffer\) return 0;/);
  });

  it('reads the month on screen, so browsing back shields that month', () => {
    // `currentMonthBudgetTransactions` here would shield September's overspend
    // while the user was reading March.
    const dashboard = read('components/Dashboard.tsx');
    const call = dashboard.slice(
      dashboard.indexOf('computeShieldedOverflow(state.budgets'),
    ).slice(0, 200);
    expect(call).toContain('viewMonthBudgetTransactions');
  });

  it('leaves the headline balance alone, so the overspend is not counted twice', () => {
    const dashboard = read('components/Dashboard.tsx');
    const remaining = dashboard.slice(
      dashboard.indexOf('const viewMonthRemaining'),
    ).slice(0, 400);
    expect(remaining).not.toContain('leisureAdjustments');
  });

  it('deducts from Leisure only, and only while the shield is on', () => {
    const list = read('components/dashboard_components/DashboardBudgetSectionsList.tsx');
    expect(list).toMatch(
      /isLeisure && safeSettings\.useLeisureAsBuffer[\s\S]{0,120}externalDeduction: leisureAdjustments/,
    );
  });

  it('never rewrites the overspent budget to look as though it fitted', () => {
    // The shield absorbs the overflow into Leisure; it does not hand the
    // overspent category a bigger limit or a smaller total, or that vial would
    // stop saying "Over by $80" the moment the shield was switched on — hiding
    // the one fact the user most needs from it.
    const list = read('components/dashboard_components/DashboardBudgetSectionsList.tsx');
    expect(list).not.toMatch(/totalLimit:\s*[^}]*leisureAdjustments/);
    expect(list).not.toMatch(/externalDeduction:\s*-/);
  });
});

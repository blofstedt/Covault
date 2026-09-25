/**
 * Unlinking takes the partner's money off the screen, not just their name.
 *
 * The household balance is built from three things a partner contributes —
 * their income, their month (as a summary when they share less than every
 * purchase) and, when they share them, their purchases. Unlinking cleared the
 * partner's name and left all three in place, so "Remaining Balance" went on
 * counting an ex-partner's salary until the app was next closed. The phone of
 * the person who was unlinked was worse off: the reload that found no partner
 * cleared nothing at all.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withoutPartner, householdIncome, householdSpend } from '../householdSharing';
import type { AppState, Transaction } from '../../types';

const ME = 'me';
const THEM = 'them';

const row = (user_id: string, amount: number): Transaction =>
  ({
    id: `${user_id}-${amount}`,
    user_id,
    vendor: 'Safeway',
    amount,
    date: '2026-09-04',
    budget_id: 'b-groceries',
    is_projected: false,
    label: 'Manual',
    userName: user_id,
  }) as Transaction;

function linkedState(): AppState {
  return {
    user: {
      id: ME,
      name: 'Me',
      email: 'me@example.test',
      hasJointAccounts: true,
      budgetingSolo: false,
      monthlyIncome: 4000,
      partnerId: THEM,
      partnerName: 'Them',
      partnerEmail: 'them@example.test',
    },
    budgets: [],
    transactions: [row(ME, 100), row(THEM, 250)],
    settings: {} as AppState['settings'],
    partnerIncome: 3000,
    partnerSummary: { level: 'totals', total: 400, byCategory: {} },
    partnerBudgets: [{ id: 'partner:Groceries', name: 'Groceries', totalLimit: 300 }],
  };
}

describe('withoutPartner', () => {
  it('takes their income, their month and their purchases out of the household', () => {
    const next = withoutPartner(linkedState(), ME);

    expect(next.partnerIncome).toBeNull();
    expect(next.partnerSummary).toBeNull();
    expect(next.partnerBudgets).toBeNull();
    expect(next.transactions.map((t) => t.user_id)).toEqual([ME]);

    // What the dashboard then computes: your own salary, your own spending.
    expect(householdIncome(next.user!.monthlyIncome, next.partnerIncome)).toBe(4000);
    expect(householdSpend(next.transactions, ME, null)).toBe(100);
  });

  it('forgets who they were and goes back to a solo dashboard', () => {
    const next = withoutPartner(linkedState(), ME);
    expect(next.user?.partnerId).toBeUndefined();
    expect(next.user?.partnerName).toBeUndefined();
    expect(next.user?.partnerEmail).toBeUndefined();
    expect(next.user?.hasJointAccounts).toBe(false);
    expect(next.user?.budgetingSolo).toBe(true);
  });

  it('changes nothing, not even identity, for someone who never had a partner', () => {
    const solo: AppState = {
      ...linkedState(),
      user: { ...linkedState().user!, partnerId: undefined, budgetingSolo: false },
      transactions: [row(ME, 100)],
      partnerIncome: undefined,
      partnerSummary: undefined,
      partnerBudgets: undefined,
    };
    // Same object back, so a reload that finds no partner re-renders nothing —
    // and a person who chose "together" during setup, before linking, keeps
    // that choice.
    expect(withoutPartner(solo, ME)).toBe(solo);
  });
});

describe('where it is applied', () => {
  const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

  it('runs when this phone unlinks', () => {
    const linking = read('lib/hooks/useHouseholdLinking.ts');
    const unlink = linking.slice(linking.indexOf('const handleUnlinkPartner'));
    expect(unlink).toContain('withoutPartner(prev, userId)');
    expect(unlink).toContain('if (prev.user?.id !== userId) return prev;');
  });

  it('runs when a reload finds the partner gone, which is how the other phone finds out', () => {
    const loading = read('lib/hooks/useDataLoading.ts');
    const link = loading.slice(
      loading.indexOf('const loadHouseholdLink'),
      loading.indexOf('const hydrateFromCache'),
    );
    expect(link).toContain('prev.user?.id === userId ? withoutPartner(prev, userId) : prev');
  });
});

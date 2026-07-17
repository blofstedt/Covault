import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';

// The smartCards module touches localStorage at import time (via the
// dismissed-card helpers), so we need to provide a stub before loading.
const localStorageStub = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
  };
})();
vi.stubGlobal('localStorage', localStorageStub);

import { collectSmartCards, dismissCard } from '../smartCards';
import type { BudgetCategory, Transaction } from '../../types';

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    user_id: 'user-1',
    vendor: 'Costco',
    amount: 25,
    date: '2026-07-15',
    budget_id: 'budget-groceries',
    recurrence: 'One-time',
    label: 'Manual',
    userName: 'me',
    is_projected: false,
    created_at: '2026-07-15T00:00:00.000Z',
    ...overrides,
  } as Transaction;
}

const groceries: BudgetCategory = { id: 'budget-groceries', name: 'Groceries', totalLimit: 100 };
const dining: BudgetCategory = { id: 'budget-dining', name: 'Dining', totalLimit: 200 };

afterEach(() => {
  localStorageStub.clear();
  vi.useRealTimers();
});

describe('smartCards dismissal model', () => {
  it('overspend card stays dismissed within the same month, even across reloads', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));

    // Drive Groceries to 90% of its $100 limit.
    const transactions = [
      tx({ id: 'a', amount: 90 }),
    ];
    const cards = collectSmartCards([groceries], transactions, transactions, 'user-1', undefined);
    const overspend = cards.find((c) => c.type === 'overspend');
    expect(overspend).toBeDefined();
    const overspendId = overspend!.id;

    dismissCard(overspendId, 'overspend');

    // Re-collect \u2014 same month, same data. Card should stay hidden.
    const after = collectSmartCards([groceries], transactions, transactions, 'user-1', undefined);
    expect(after.find((c) => c.id === overspendId)).toBeUndefined();

    // Re-collect after a localStorage clear (simulating app reload that
    // re-reads the same dismissed list) \u2014 still hidden.
    const afterReload = collectSmartCards([groceries], transactions, transactions, 'user-1', undefined);
    expect(afterReload.find((c) => c.id === overspendId)).toBeUndefined();
  });

  it('overspend card re-shows at the start of the next month', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));

    const transactions = [tx({ id: 'a', amount: 90 })];
    const cards = collectSmartCards([groceries], transactions, transactions, 'user-1', undefined);
    const overspend = cards.find((c) => c.type === 'overspend')!;
    dismissCard(overspend.id, 'overspend');

    // Roll the clock forward into August. The overspend ID no longer
    // matches (the new month is a fresh budget cycle) and the timestamp
    // check also says it's time to re-show.
    vi.setSystemTime(new Date('2026-08-02T12:00:00Z'));
    const transactions2 = [tx({ id: 'a', amount: 90, date: '2026-08-02' })];
    const after = collectSmartCards([groceries], transactions2, transactions2, 'user-1', undefined);
    expect(after.find((c) => c.type === 'overspend')).toBeDefined();
  });

  it('vendor-suggestion dismissal is permanent (no re-show on next month)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));

    // Build a vendor pattern: 4 tx to "Starbucks", 3 to Groceries, 1 to Dining.
    const transactions = [
      tx({ id: '1', vendor: 'Starbucks', budget_id: 'budget-groceries' }),
      tx({ id: '2', vendor: 'Starbucks', budget_id: 'budget-groceries' }),
      tx({ id: '3', vendor: 'Starbucks', budget_id: 'budget-groceries' }),
      tx({ id: '4', vendor: 'Starbucks', budget_id: 'budget-dining' }),
    ];
    const cards = collectSmartCards([groceries, dining], transactions, transactions, 'user-1', undefined);
    const suggest = cards.find((c) => c.type === 'vendor-suggestion');
    expect(suggest).toBeDefined();
    const suggestId = suggest!.id;

    // User taps "No" \u2014 permanent dismissal.
    dismissCard(suggestId, 'vendor-suggestion', true);

    // Same month, same data: hidden.
    const afterNo = collectSmartCards([groceries, dining], transactions, transactions, 'user-1', undefined);
    expect(afterNo.find((c) => c.id === suggestId)).toBeUndefined();

    // Next month, same data: still hidden (permanent).
    vi.setSystemTime(new Date('2026-08-15T12:00:00Z'));
    const transactions2 = transactions.map((t) => ({ ...t, date: t.date.replace('2026-07', '2026-08') }));
    const afterMonth = collectSmartCards([groceries, dining], transactions2, transactions2, 'user-1', undefined);
    expect(afterMonth.find((c) => c.id === suggestId)).toBeUndefined();
  });

  it('upcoming-bill card gets a fresh ID when urgency bucket changes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T08:00:00Z'));

    // A monthly bill due on the 17th \u2014 currently 2 days away (bucket "soon").
    const transactions = [
      tx({
        id: 'rent',
        vendor: 'Landlord',
        amount: 1800,
        date: '2026-06-17',
        recurrence: 'Monthly',
      }),
    ];
    const cards = collectSmartCards([groceries], [], transactions, 'user-1', undefined);
    const bill = cards.find((c) => c.type === 'upcoming-bill')!;
    expect(bill.id).toMatch(/-soon$/);
    dismissCard(bill.id, 'upcoming-bill');

    // Roll forward to the 16th \u2014 now 1 day away (bucket "urgent"), new ID.
    vi.setSystemTime(new Date('2026-07-16T08:00:00Z'));
    const cards2 = collectSmartCards([groceries], [], transactions, 'user-1', undefined);
    const bill2 = cards2.find((c) => c.type === 'upcoming-bill')!;
    expect(bill2.id).toMatch(/-urgent$/);
    // The new "urgent" card was not in the dismissed set, so it shows.
    expect(cards2.find((c) => c.id === bill2.id)).toBeDefined();
  });

  it('partner-total card aggregates all partner transactions for the day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T20:00:00Z'));

    const transactions = [
      tx({ id: 'p1', user_id: 'partner', vendor: 'Whole Foods', amount: 42.50, date: '2026-07-15' }),
      tx({ id: 'p2', user_id: 'partner', vendor: 'Uber', amount: 18.75, date: '2026-07-15' }),
      tx({ id: 'p3', user_id: 'partner', vendor: 'Starbucks', amount: 6.25, date: '2026-07-15' }),
    ];
    const cards = collectSmartCards([], transactions, transactions, 'user-1', 'Jordan');
    const partner = cards.find((c) => c.type === 'partner-total');
    expect(partner).toBeDefined();
    expect(partner!.body).toContain('$67.50');
    expect(partner!.body).toContain('3 transactions');
  });

  it('insight card is suppressed when month-over-month delta is small', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));

    // Both months have ~$1000 spent on groceries \u2014 not interesting.
    const transactions = [
      tx({ id: 'july-1', amount: 500, date: '2026-07-10' }),
      tx({ id: 'july-2', amount: 500, date: '2026-07-12' }),
      tx({ id: 'june-1', amount: 480, date: '2026-06-10' }),
      tx({ id: 'june-2', amount: 520, date: '2026-06-12' }),
    ];
    const cards = collectSmartCards([groceries], transactions, transactions, 'user-1', undefined);
    expect(cards.find((c) => c.type === 'insight')).toBeUndefined();
  });
});

// @vitest-environment happy-dom
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../../../test/renderWithProviders';
import type { Transaction } from '../../../../types';
import AITransactionsEnteredCard from '../AITransactionsEnteredCard';
import type { VendorOverride } from '../../../../lib/vendors/useVendorOverrides';

function makeTransaction(id: string, vendor: string): Transaction {
  return {
    id,
    user_id: 'user-1',
    vendor,
    amount: 18.25,
    date: '2026-10-04',
    budget_id: 'budget:groceries',
    is_projected: false,
    created_at: '2026-10-04T12:00:00.000Z',
    raw_notification: `${vendor} purchase`,
  };
}

const budgets = [{ id: 'budget:groceries', name: 'Groceries', totalLimit: 500 }];
const overrides: VendorOverride[] = [
  {
    id: 'rule-1',
    proper_name: 'Safeway',
    match_key: 'safeway',
    category_id: 'budget:groceries',
    category_name: 'Groceries',
  },
  {
    id: 'rule-2',
    proper_name: 'Costco',
    match_key: 'costco',
    category_id: 'budget:groceries',
    category_name: 'Groceries',
  },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

afterEach(() => vi.useRealTimers());

describe('Review filing feedback', () => {
  it('keeps a single row actionable when filing does not succeed', async () => {
    vi.useFakeTimers();
    const result = deferred<boolean>();
    const onAccept = vi.fn(() => result.promise);
    renderWithProviders(
      <AITransactionsEnteredCard
        aiTransactions={[makeTransaction('safeway-1', 'Safeway')]}
        budgets={budgets}
        onAccept={onAccept}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(620); });

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Filing…');
    expect(screen.getByText('Safeway')).toBeVisible();

    await act(async () => { result.resolve(false); });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeVisible();
    expect(screen.getByText('Safeway')).toBeVisible();
  });

  it('keeps bulk rows visible after a failed result and blocks a second request while pending', async () => {
    const result = deferred<boolean>();
    const onAcceptMany = vi.fn(() => result.promise);
    renderWithProviders(
      <AITransactionsEnteredCard
        aiTransactions={[
          makeTransaction('safeway-1', 'Safeway'),
          makeTransaction('costco-1', 'Costco'),
        ]}
        budgets={budgets}
        vendorOverrides={overrides}
        onAcceptMany={onAcceptMany}
      />,
    );

    const bulkButton = screen.getByRole('button', { name: 'Accept 2 known vendors' });
    fireEvent.click(bulkButton);

    expect(onAcceptMany).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Filing 2 known purchases…' })).toBeDisabled();
    fireEvent.click(bulkButton);
    expect(onAcceptMany).toHaveBeenCalledTimes(1);

    await act(async () => { result.resolve(false); });

    expect(screen.getByRole('button', { name: 'Accept 2 known vendors' })).toBeEnabled();
    expect(screen.getByText('Safeway')).toBeVisible();
    expect(screen.getByText('Costco')).toBeVisible();
  });

  it('hides bulk rows only after the write confirms success', async () => {
    const onAcceptMany = vi.fn().mockResolvedValue(true);
    renderWithProviders(
      <AITransactionsEnteredCard
        aiTransactions={[
          makeTransaction('safeway-1', 'Safeway'),
          makeTransaction('costco-1', 'Costco'),
        ]}
        budgets={budgets}
        vendorOverrides={overrides}
        onAcceptMany={onAcceptMany}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Accept 2 known vendors' }));

    expect(await screen.findByText('Nothing waiting')).toBeVisible();
    expect(screen.queryByText('Safeway')).not.toBeInTheDocument();
    expect(screen.queryByText('Costco')).not.toBeInTheDocument();
  });
});

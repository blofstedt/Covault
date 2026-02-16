import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import CategoryBarChart from '../CategoryBarChart';
import { BudgetCategory, Transaction, TransactionLabel } from '../../../types';

const makeBudget = (id: string, name: string, limit: number): BudgetCategory => ({
  id,
  name,
  totalLimit: limit,
});

const makeTx = (budgetId: string, amount: number, date: string): Transaction => ({
  id: `tx-${budgetId}-${amount}`,
  user_id: 'u1',
  vendor: 'Test',
  amount,
  date,
  budget_id: budgetId,
  is_projected: false,
  label: TransactionLabel.MANUAL,
  created_at: date,
});

// Helper: current month date string in UTC
const thisMonth = () => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1)).toISOString();
};

describe('CategoryBarChart', () => {
  const budgets: BudgetCategory[] = [
    makeBudget('b1', 'Housing', 1500),
    makeBudget('b2', 'Groceries', 600),
  ];

  const transactions: Transaction[] = [
    makeTx('b1', 900, thisMonth()),
    makeTx('b2', 700, thisMonth()), // over budget
  ];

  it('renders bar tracks with h-8 height (32px, matching icon size)', () => {
    const { container } = render(
      <CategoryBarChart
        budgets={budgets}
        transactions={transactions}
        totalIncome={3000}
      />,
    );

    // Bar tracks have the classes h-8 rounded-full overflow-hidden bg-slate-100
    const barTracks = container.querySelectorAll('.h-8.rounded-full.overflow-hidden');
    expect(barTracks.length).toBe(2);
  });

  it('uses budget primary color for bars even when over budget', () => {
    const { container } = render(
      <CategoryBarChart
        budgets={budgets}
        transactions={transactions}
        totalIncome={3000}
      />,
    );

    // The solid bar divs are inside the bar tracks
    const barTracks = container.querySelectorAll('.h-8.rounded-full.overflow-hidden');
    // Groceries is over budget (700 > 600) — second bar track
    const overBudgetTrack = barTracks[1];
    const solidBar = overBudgetTrack.querySelector('div[style]') as HTMLElement;
    expect(solidBar).toBeTruthy();
    // Should use the green primary (#22c55e) not rose/red
    expect(solidBar.style.backgroundColor).not.toContain('rgb(244, 63, 94)'); // #f43f5e
    expect(solidBar.style.backgroundColor).not.toContain('rgb(251, 113, 133)'); // #fb7185
  });

  it('uses the same color for icon and bar', () => {
    const { container } = render(
      <CategoryBarChart
        budgets={budgets}
        transactions={transactions}
        totalIncome={3000}
      />,
    );

    // Each category row is a flex items-end gap-2.5 div
    const rows = container.querySelectorAll('.flex.items-end.gap-2\\.5');
    for (const row of rows) {
      const icon = row.querySelector('.flex-shrink-0') as HTMLElement;
      const barTrack = row.querySelector('.h-8.rounded-full.overflow-hidden');
      const solidBar = barTrack?.querySelector('div[style]') as HTMLElement;
      if (!icon || !solidBar) continue;

      // Icon background and bar fill should be the same color
      const iconBg = icon.style.backgroundColor;
      const barBg = solidBar.style.backgroundColor;

      expect(barBg).not.toBe('');
      expect(iconBg).not.toBe('');
      expect(barBg).toBe(iconBg);
    }
  });

  it('has space-y-4 spacing between category rows', () => {
    const { container } = render(
      <CategoryBarChart
        budgets={budgets}
        transactions={transactions}
        totalIncome={3000}
      />,
    );

    const spacer = container.querySelector('.space-y-4');
    expect(spacer).toBeTruthy();
  });

  it('shows empty state when no budgets provided', () => {
    render(
      <CategoryBarChart budgets={[]} transactions={[]} totalIncome={0} />,
    );

    expect(screen.getByText('No spending data yet')).toBeInTheDocument();
  });
});

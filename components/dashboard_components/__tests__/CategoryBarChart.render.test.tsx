import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import CategoryBarChart from '../CategoryBarChart';
import { TransactionLabel } from '../../../types';

describe('CategoryBarChart rendering verification', () => {
  const now = new Date();
  const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  const budgets = [
    { id: 'b1', name: 'Housing', totalLimit: 1500 },
    { id: 'b2', name: 'Groceries', totalLimit: 600 },
    { id: 'b5', name: 'Leisure', totalLimit: 400 },
  ];

  const transactions = [
    { id: 't1', user_id: 'u', vendor: 'Rent', amount: 900, date: thisMonth, budget_id: 'b1', is_projected: false, label: TransactionLabel.MANUAL, created_at: thisMonth },
    { id: 't2', user_id: 'u', vendor: 'Store', amount: 450, date: thisMonth, budget_id: 'b2', is_projected: false, label: TransactionLabel.MANUAL, created_at: thisMonth },
    { id: 't5', user_id: 'u', vendor: 'Fun', amount: 500, date: thisMonth, budget_id: 'b5', is_projected: false, label: TransactionLabel.MANUAL, created_at: thisMonth },
  ];

  it('renders h-8 bar tracks and space-y-4 spacing', () => {
    const html = renderToString(
      React.createElement(CategoryBarChart, { budgets, transactions, totalIncome: 3000, theme: 'dark' }),
    );

    expect(html).toContain('h-8');
    expect(html).toContain('space-y-4');
  });

  it('does NOT use rose/red for over-budget bars', () => {
    const html = renderToString(
      React.createElement(CategoryBarChart, { budgets, transactions, totalIncome: 3000, theme: 'dark' }),
    );

    // These are the rose colors that were used for over-budget bars before
    expect(html).not.toContain('#fb7185');
    expect(html).not.toContain('#f43f5e');
  });

  it('uses budget primary color for over-budget bar (Leisure pink #ec4899)', () => {
    const html = renderToString(
      React.createElement(CategoryBarChart, { budgets, transactions, totalIncome: 3000, theme: 'dark' }),
    );

    // Leisure is over budget (500 > 400), its bar should use #ec4899 (pink primary)
    expect(html).toContain('#ec4899');
  });

  it('fills actual bar with brighter primary color and outlines with primary color', () => {
    const html = renderToString(
      React.createElement(CategoryBarChart, { budgets, transactions, totalIncome: 3000, theme: 'dark' }),
    );

    // Housing: primary=#6366f1 — bar fill uses brighter opacity (#6366f140), icon uses subtler (#6366f125)
    expect(html).toContain('background-color:#6366f140');
    expect(html).toContain('border:2px solid #6366f1');
    expect(html).toContain('background-color:#6366f125');
  });

  it('hatched bar rect has no rx attribute (no tapering)', () => {
    const html = renderToString(
      React.createElement(CategoryBarChart, {
        budgets,
        transactions,
        projectedTransactions: [
          { id: 'p1', user_id: 'u', vendor: 'Proj', amount: 100, date: thisMonth, budget_id: 'b1', is_projected: true, label: TransactionLabel.MANUAL, created_at: thisMonth },
        ],
        totalIncome: 3000,
        theme: 'dark',
      }),
    );

    // The hatched rect should NOT have rx="9999" for tapering
    expect(html).not.toContain('rx="9999"');
  });
});

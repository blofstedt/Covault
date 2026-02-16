import React, { useMemo } from 'react';
import { BudgetCategory, Transaction, TransactionLabel } from '../../types';
import { getBudgetColor } from './budgetColors';

interface CategoryBarChartProps {
  budgets: BudgetCategory[];
  transactions: Transaction[];
  totalIncome: number;
  isTutorialMode?: boolean;
  theme?: 'light' | 'dark';
}

// Fraction of budget limit used to generate placeholder tutorial data
const TUTORIAL_SPEND_RATIO = 0.6;

const CategoryBarChart: React.FC<CategoryBarChartProps> = ({
  budgets,
  transactions,
  totalIncome,
  isTutorialMode = false,
  theme = 'dark',
}) => {
  const safeBudgets = Array.isArray(budgets) ? budgets : [];

  // Current month transactions only
  const currentMonthTxs = useMemo(() => {
    const txs = Array.isArray(transactions) ? transactions : [];
    if (isTutorialMode && txs.length === 0 && safeBudgets.length > 0) {
      const now = new Date();
      return safeBudgets.map((b, i) => ({
        id: `__tutorial_bar_${i}__`,
        vendor: 'Tutorial',
        amount: Math.round((b.totalLimit || 500) * TUTORIAL_SPEND_RATIO * 100) / 100,
        date: now.toISOString(),
        budget_id: b.id,
        user_id: '__tutorial__',
        is_projected: false,
        label: TransactionLabel.MANUAL,
        created_at: now.toISOString(),
      })) as Transaction[];
    }
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    return txs.filter((tx) => {
      const d = new Date(tx.date);
      return d.getUTCFullYear() === year && d.getUTCMonth() === month && !tx.is_projected;
    });
  }, [transactions, isTutorialMode, safeBudgets]);

  // Per-category spending
  const categoryData = useMemo(() => {
    const budgetNameById = new Map<string, string>();
    const budgetIdByName = new Map<string, string>();
    safeBudgets.forEach((b) => {
      budgetNameById.set(b.id, b.name);
      budgetIdByName.set(b.name, b.id);
    });

    const spendMap = new Map<string, number>();
    safeBudgets.forEach((b) => spendMap.set(b.name, 0));

    for (const tx of currentMonthTxs) {
      if (tx.splits && tx.splits.length > 0) {
        for (const split of tx.splits) {
          const catName = budgetNameById.get(split.budget_id) || 'Other';
          spendMap.set(catName, (spendMap.get(catName) || 0) + (split.amount || 0));
        }
      } else {
        const catName = tx.budget_id ? (budgetNameById.get(tx.budget_id) || 'Other') : 'Other';
        spendMap.set(catName, (spendMap.get(catName) || 0) + tx.amount);
      }
    }

    return safeBudgets.map((b, i) => ({
      name: b.name,
      spent: spendMap.get(b.name) || 0,
      limit: b.totalLimit,
      color: getBudgetColor(b.name, i),
    }));
  }, [safeBudgets, currentMonthTxs]);

  const totalSpent = categoryData.reduce((sum, c) => sum + c.spent, 0);
  const totalBudget = categoryData.reduce((sum, c) => sum + c.limit, 0);
  const maxValue = Math.max(totalIncome, totalBudget, totalSpent, 1);

  // Spend ratio line position
  const spendRatio = totalIncome > 0 ? Math.min((totalSpent / totalIncome) * 100, 100) : 0;

  if (categoryData.length === 0) {
    return (
      <div className="w-full mb-2">
        <div className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-md rounded-3xl p-4 border border-slate-200/40 dark:border-slate-700/40 shadow-lg">
          <div className="text-center py-6">
            <p className="text-sm font-bold text-slate-500 dark:text-slate-400 mb-1">No spending data yet</p>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Add transactions to see your category breakdown.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div id="spending-flow-chart" className="w-full mb-1 shrink-0">
      <div className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-md rounded-3xl p-4 pt-3 border border-slate-200/40 dark:border-slate-700/40 shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
            This Month
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">
              ${totalSpent.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
            <span className="text-[10px] font-medium text-slate-300 dark:text-slate-600">/</span>
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">
              ${totalIncome.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
          </div>
        </div>

        {/* Bar chart */}
        <div className="space-y-2 relative">
          {categoryData.map((cat, i) => {
            const barPct = maxValue > 0 ? Math.min((cat.spent / maxValue) * 100, 100) : 0;
            const limitPct = maxValue > 0 ? Math.min((cat.limit / maxValue) * 100, 100) : 0;
            const isOver = cat.spent > cat.limit;

            return (
              <div key={cat.name} className="flex items-center gap-3">
                {/* Category label */}
                <div className="w-[60px] flex-shrink-0 text-right">
                  <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 truncate block">
                    {cat.name}
                  </span>
                </div>

                {/* Bar container */}
                <div className="flex-1 relative h-6 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800/60">
                  {/* Budget limit marker */}
                  <div
                    className="absolute top-0 bottom-0 w-px z-20"
                    style={{
                      left: `${limitPct}%`,
                      backgroundColor: theme === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)',
                    }}
                  />

                  {/* Spent bar */}
                  <div
                    className="absolute top-0.5 bottom-0.5 left-0 rounded-md transition-all duration-700 ease-out"
                    style={{
                      width: `${barPct}%`,
                      backgroundColor: isOver
                        ? (theme === 'dark' ? '#fb7185' : '#f43f5e')
                        : cat.color.primary,
                      minWidth: cat.spent > 0 ? '4px' : '0px',
                    }}
                  />
                </div>

                {/* Amount */}
                <div className="w-[50px] flex-shrink-0">
                  <span className={`text-[10px] font-black tracking-tight ${
                    isOver
                      ? 'text-rose-500'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}>
                    ${cat.spent.toFixed(0)}
                  </span>
                </div>
              </div>
            );
          })}

          {/* Total income line overlay */}
          {totalIncome > 0 && (
            <div className="relative h-1 mt-1">
              <div className="absolute inset-x-0 h-px top-1/2 bg-slate-200 dark:bg-slate-700/60 rounded-full" />
              {/* Spend progress */}
              <div
                className="absolute top-0 left-0 h-1 rounded-full transition-all duration-700 ease-out"
                style={{
                  width: `${spendRatio}%`,
                  background: totalSpent > totalIncome
                    ? 'linear-gradient(90deg, #f43f5e, #fb7185)'
                    : `linear-gradient(90deg, #10b981, #34d399)`,
                }}
              />
              {/* Pay marker */}
              <div
                className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full border-2 z-10"
                style={{
                  right: '0px',
                  backgroundColor: theme === 'dark' ? '#1e293b' : '#ffffff',
                  borderColor: theme === 'dark' ? '#64748b' : '#94a3b8',
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CategoryBarChart;

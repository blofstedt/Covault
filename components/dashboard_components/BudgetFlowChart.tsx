import React, { useMemo, useState } from 'react';
import { BudgetCategory, Transaction } from '../../types';
import { getBudgetIcon } from './getBudgetIcon';

interface BudgetFlowChartProps {
  budgets: BudgetCategory[];
  transactions: Transaction[];
}

interface MonthData {
  year: number;
  month: number;
  label: string;
  budgetSpending: Map<string, number>;
  total: number;
}

type FilterMode = 'current' | 'last6';

const BudgetFlowChart: React.FC<BudgetFlowChartProps> = ({
  budgets,
  transactions,
}) => {
  // Minimum width percentage to show label in bar
  const MIN_WIDTH_FOR_LABEL = 15;
  
  // Filter state: 'current' for current month, 'last6' for last 6 months
  const [filterMode, setFilterMode] = useState<FilterMode>('current');

  // Current date - memoized to avoid recreating on every render
  const { currentYear, currentMonth } = useMemo(() => {
    const now = new Date();
    return {
      currentYear: now.getFullYear(),
      currentMonth: now.getMonth(),
    };
  }, []);

  // Group transactions by month
  const monthlyData = useMemo(() => {
    const dataMap = new Map<string, MonthData>();

    transactions.forEach((tx) => {
      // Skip projected transactions
      if (tx.is_projected) return;

      const date = new Date(tx.date);
      const year = date.getFullYear();
      const month = date.getMonth();
      const key = `${year}-${month}`;

      if (!dataMap.has(key)) {
        dataMap.set(key, {
          year,
          month,
          label: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          budgetSpending: new Map(),
          total: 0,
        });
      }

      const monthData = dataMap.get(key)!;

      // Handle split transactions
      if (tx.splits && tx.splits.length > 0) {
        tx.splits.forEach((split) => {
          const current = monthData.budgetSpending.get(split.budget_id) || 0;
          monthData.budgetSpending.set(split.budget_id, current + split.amount);
          monthData.total += split.amount;
        });
      } else if (tx.budget_id) {
        const current = monthData.budgetSpending.get(tx.budget_id) || 0;
        monthData.budgetSpending.set(tx.budget_id, current + tx.amount);
        monthData.total += tx.amount;
      }
    });

    // Sort by date (oldest to newest)
    const sorted = Array.from(dataMap.values()).sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.month - b.month;
    });

    // For 'current' mode, only show current month
    // For 'last6' mode, show last 6 months
    if (filterMode === 'current') {
      return sorted.filter(m => m.year === currentYear && m.month === currentMonth);
    } else {
      return sorted.slice(-6);
    }
  }, [transactions, filterMode, currentYear, currentMonth]);

  // If no data, show empty state
  if (monthlyData.length === 0) {
    return null;
  }

  // Calculate the max total for scaling
  const maxTotal = Math.max(...monthlyData.map((m) => m.total), 1);

  const budgetIndexMap = useMemo(
    () =>
      new Map(
        budgets.map((budget, index) => [
          budget.name.toLowerCase(),
          index,
        ]),
      ),
    [budgets],
  );

  // Get budget colors with consistent mapping (limited palette to match app UX)
  const getBudgetColor = (budgetName: string) => {
    const palette = [
      'rgb(16, 185, 129)', // emerald
      'rgb(52, 211, 153)', // light emerald
      'rgb(148, 163, 184)', // slate
    ];
    const budgetIndex = budgetIndexMap.get(budgetName.toLowerCase()) ?? 0;
    const paletteIndex = budgetIndex >= 0 ? budgetIndex % palette.length : 0;
    return palette[paletteIndex];
  };

  return (
    <div className="w-full mb-4">
      <div className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-md rounded-3xl p-4 border-2 border-slate-100 dark:border-slate-800 shadow-lg">
        {/* Chart Title and Filter */}
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
            Spending Overview
          </h3>
          
          {/* Filter Toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setFilterMode('current')}
              className={`px-2.5 py-1 text-[10px] font-bold rounded-lg transition-all ${
                filterMode === 'current'
                  ? 'bg-emerald-500 text-white'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600'
              }`}
            >
              Current Month
            </button>
            <button
              onClick={() => setFilterMode('last6')}
              className={`px-2.5 py-1 text-[10px] font-bold rounded-lg transition-all ${
                filterMode === 'last6'
                  ? 'bg-emerald-500 text-white'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600'
              }`}
            >
              Last 6 Months
            </button>
          </div>
        </div>

        {/* Empty state for Last 6 Months mode when only current month exists */}
        {filterMode === 'last6' && monthlyData.length <= 1 ? (
          <div className="text-center py-8">
            <p className="text-sm font-bold text-slate-500 dark:text-slate-400 mb-2">
              No additional months found
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Please continue using the app to gather historical data.
            </p>
          </div>
        ) : monthlyData.length === 0 ? (
          // No data at all (even for current month)
          null
        ) : (
          <>
            {/* Simple Bar Chart */}
            <div className="space-y-3">
              {monthlyData.map((monthData) => (
                <div key={`${monthData.year}-${monthData.month}`} className="space-y-2">
                  {/* Month Label */}
                  <div className="flex justify-between items-baseline">
                    <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                      {monthData.label}
                    </span>
                    <span 
                      className="text-[10px] font-black text-slate-600 dark:text-slate-300"
                      aria-label={monthData.total.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    >
                      ${monthData.total.toFixed(0)}
                    </span>
                  </div>
                  
                  {/* Bar */}
                  <div className="w-full h-6 bg-slate-100 dark:bg-slate-800 rounded-xl overflow-hidden flex">
                    {budgets.map((budget) => {
                      const spending = monthData.budgetSpending.get(budget.id) || 0;
                      if (spending === 0) return null;
                      
                      const widthPercent = (spending / monthData.total) * 100;
                      
                      return (
                        <div
                          key={budget.id}
                          className="h-full flex items-center justify-center relative group"
                          style={{
                            width: `${widthPercent}%`,
                            backgroundColor: getBudgetColor(budget.name),
                          }}
                          aria-label={`${budget.name}: ${spending.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
                        >
                          {widthPercent > MIN_WIDTH_FOR_LABEL && (
                            <span className="text-[9px] font-bold text-white">
                              ${spending.toFixed(0)}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Legend */}
            <div className="mt-4 pt-3 border-t-2 border-slate-100 dark:border-slate-800">
              <div className="flex flex-wrap gap-2 justify-center">
                {budgets.map((budget) => (
                  <div key={budget.id} className="flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: getBudgetColor(budget.name) }}
                    />
                    <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                      {budget.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default BudgetFlowChart;

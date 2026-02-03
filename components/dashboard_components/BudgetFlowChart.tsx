import React, { useState, useMemo, useRef, useEffect } from 'react';
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

const BudgetFlowChart: React.FC<BudgetFlowChartProps> = ({
  budgets,
  transactions,
}) => {
  const [expandedBudgetId, setExpandedBudgetId] = useState<string | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);

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
    return Array.from(dataMap.values()).sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.month - b.month;
    });
  }, [transactions]);

  // If no data, show empty state
  if (monthlyData.length === 0) {
    return null;
  }

  // Calculate the max total for scaling
  const maxTotal = Math.max(...monthlyData.map((m) => m.total), 1);

  // Get budget colors with consistent mapping
  const getBudgetColor = (budgetName: string, opacity: number = 1) => {
    const lower = budgetName.toLowerCase();
    const colors: Record<string, string> = {
      housing: `rgba(59, 130, 246, ${opacity})`, // blue
      groceries: `rgba(16, 185, 129, ${opacity})`, // emerald
      transport: `rgba(245, 158, 11, ${opacity})`, // amber
      utilities: `rgba(139, 92, 246, ${opacity})`, // purple
      leisure: `rgba(236, 72, 153, ${opacity})`, // pink
      other: `rgba(107, 114, 128, ${opacity})`, // gray
    };

    for (const [key, color] of Object.entries(colors)) {
      if (lower.includes(key)) return color;
    }
    return `rgba(107, 114, 128, ${opacity})`; // default gray
  };

  const handleBudgetClick = (budgetId: string) => {
    if (isAnimating) return;

    setIsAnimating(true);
    if (expandedBudgetId === budgetId) {
      setExpandedBudgetId(null);
    } else {
      setExpandedBudgetId(budgetId);
    }

    // Reset animation state after animation completes
    setTimeout(() => setIsAnimating(false), 400);
  };

  const handleClickOutside = (e: React.MouseEvent) => {
    if (expandedBudgetId && e.target === e.currentTarget) {
      handleBudgetClick(expandedBudgetId);
    }
  };

  return (
    <div
      className="w-full mb-6 animate-nest"
      style={{ animationDelay: '0.2s' }}
      onClick={handleClickOutside}
    >
      <div
        ref={chartRef}
        className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-md rounded-3xl p-6 border-2 border-slate-100 dark:border-slate-800 shadow-lg transition-all duration-300"
      >
        {/* Chart Title */}
        <div className="mb-4 text-center">
          <h3 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
            Budget Spending Flow
          </h3>
        </div>

        {/* Flow Chart Container */}
        <div className="relative h-48 overflow-hidden">
          {/* Month labels at bottom */}
          <div className="absolute bottom-0 left-0 right-0 flex justify-between px-2 pb-2">
            {monthlyData.map((monthData, idx) => (
              <div
                key={`${monthData.year}-${monthData.month}`}
                className="flex-1 text-center"
                style={{
                  minWidth: `${100 / monthlyData.length}%`,
                }}
              >
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">
                  {monthData.label}
                </span>
              </div>
            ))}
          </div>

          {/* Flow visualization */}
          <div className="absolute top-0 left-0 right-0 bottom-8 flex gap-1">
            {monthlyData.map((monthData, monthIdx) => {
              const monthWidth = 100 / monthlyData.length;

              return (
                <div
                  key={`${monthData.year}-${monthData.month}`}
                  className="flex-1 flex flex-col-reverse gap-0.5"
                  style={{
                    minWidth: `${monthWidth}%`,
                  }}
                >
                  {budgets.map((budget) => {
                    const spending = monthData.budgetSpending.get(budget.id) || 0;
                    const heightPercent = monthData.total > 0
                      ? (spending / maxTotal) * 100
                      : 0;

                    // If expanded, only show the expanded budget
                    if (expandedBudgetId && expandedBudgetId !== budget.id) {
                      return null;
                    }

                    // If this budget is expanded, make it take full height
                    const expandedHeight = expandedBudgetId === budget.id
                      ? (spending > 0 ? 90 : 0) // Take 90% of container when expanded
                      : heightPercent;

                    if (spending === 0) return null;

                    return (
                      <div
                        key={budget.id}
                        className="relative rounded-lg cursor-pointer transition-all duration-300 hover:opacity-80 group"
                        style={{
                          height: `${expandedHeight}%`,
                          backgroundColor: getBudgetColor(budget.name, 0.8),
                          minHeight: spending > 0 ? '8px' : '0px',
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleBudgetClick(budget.id);
                        }}
                      >
                        {/* Budget icon - show in middle column or when expanded */}
                        {(monthIdx === Math.floor(monthlyData.length / 2) ||
                          expandedBudgetId === budget.id) &&
                          spending > 0 && (
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <div
                                className="text-white drop-shadow-md transition-transform duration-300"
                                style={{
                                  transform: expandedBudgetId === budget.id ? 'scale(1.5)' : 'scale(1)',
                                }}
                              >
                                {getBudgetIcon(budget.name)}
                              </div>
                            </div>
                          )}

                        {/* Spending amount on hover or when expanded */}
                        {expandedBudgetId === budget.id && (
                          <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs font-bold text-slate-500 dark:text-slate-400 whitespace-nowrap bg-white/90 dark:bg-slate-800/90 px-2 py-1 rounded-lg backdrop-blur-sm">
                            ${spending.toFixed(0)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* Expanded Budget Details */}
        {expandedBudgetId && (
          <div className="mt-4 pt-4 border-t-2 border-slate-100 dark:border-slate-800 animate-nest">
            {(() => {
              const budget = budgets.find((b) => b.id === expandedBudgetId);
              if (!budget) return null;

              return (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center"
                        style={{ backgroundColor: getBudgetColor(budget.name, 0.2) }}
                      >
                        <div style={{ color: getBudgetColor(budget.name, 1) }}>
                          {getBudgetIcon(budget.name)}
                        </div>
                      </div>
                      <div>
                        <h4 className="font-black text-sm text-slate-500 dark:text-slate-100">
                          {budget.name}
                        </h4>
                        <p className="text-xs font-bold text-slate-400 dark:text-slate-500">
                          Detailed Spending
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Monthly breakdown */}
                  <div className="grid grid-cols-2 gap-2">
                    {monthlyData.map((monthData) => {
                      const spending = monthData.budgetSpending.get(expandedBudgetId) || 0;
                      if (spending === 0) return null;

                      return (
                        <div
                          key={`${monthData.year}-${monthData.month}`}
                          className="bg-slate-50 dark:bg-slate-800 rounded-xl p-3"
                        >
                          <div className="text-xs font-bold text-slate-400 dark:text-slate-500">
                            {monthData.label}
                          </div>
                          <div className="text-lg font-black text-slate-500 dark:text-slate-100">
                            ${spending.toFixed(0)}
                          </div>
                          <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500">
                            {monthData.total > 0
                              ? `${((spending / monthData.total) * 100).toFixed(0)}% of month`
                              : ''}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
};

export default BudgetFlowChart;

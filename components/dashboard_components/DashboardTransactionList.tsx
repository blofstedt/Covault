import React, { useState, useMemo } from 'react';
import type { Transaction, BudgetCategory } from '../../types';
import TransactionItem from '../TransactionItem';
import { getBudgetColor } from './budgetColors';
import { getBudgetIcon } from './getBudgetIcon';

type TimeFilter = 'past' | 'current' | 'future';

interface DashboardTransactionListProps {
  currentMonthTransactions: Transaction[];
  pastTransactions: Transaction[];
  futureTransactions: Transaction[];
  budgets: BudgetCategory[];
  currentUserName: string;
  isSharedAccount: boolean;
  onTransactionTap: (tx: Transaction) => void;
  scrollContainerRef: React.RefObject<HTMLDivElement>;
}

const DashboardTransactionList: React.FC<DashboardTransactionListProps> = ({
  currentMonthTransactions,
  pastTransactions,
  futureTransactions,
  budgets,
  currentUserName,
  isSharedAccount,
  onTransactionTap,
  scrollContainerRef,
}) => {
  const [activeFilter, setActiveFilter] = useState<TimeFilter>('current');

  // Build a budget id → index map for stable color assignment
  const budgetIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    budgets.forEach((b, i) => map.set(b.id, i));
    return map;
  }, [budgets]);

  const transactions = useMemo(() => {
    let list: Transaction[];
    switch (activeFilter) {
      case 'past':
        list = pastTransactions;
        break;
      case 'future':
        list = futureTransactions;
        break;
      case 'current':
      default:
        list = currentMonthTransactions;
        break;
    }
    // Sort by date descending (most recent first)
    return [...list].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [activeFilter, currentMonthTransactions, pastTransactions, futureTransactions]);

  const tabs: { key: TimeFilter; label: string }[] = [
    { key: 'past', label: 'Past' },
    { key: 'current', label: 'Current' },
    { key: 'future', label: 'Future' },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden mt-1">
      {/* Toggle bar */}
      <div className="flex items-center justify-center shrink-0 mb-2">
        <div className="inline-flex rounded-2xl p-1 bg-slate-100/90 dark:bg-slate-800/80 border border-slate-200/40 dark:border-slate-700/40">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveFilter(tab.key)}
              className={`px-5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-[0.15em] transition-all duration-200 ${
                activeFilter === tab.key
                  ? 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-100 shadow-sm'
                  : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Transaction list */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto no-scrollbar pb-24 scroll-smooth space-y-2"
      >
        {transactions.length > 0 ? (
          transactions.map((tx) => {
            const budgetId =
              tx.splits && tx.splits.length > 0
                ? tx.splits[0].budget_id
                : tx.budget_id;
            const budget = budgetId ? budgets.find((b) => b.id === budgetId) : null;
            const budgetIdx = budgetId ? (budgetIndexMap.get(budgetId) ?? 0) : 0;
            const color = budget ? getBudgetColor(budget.name, budgetIdx) : null;

            return (
              <div key={tx.id} className="relative overflow-hidden rounded-[2rem]">
                <button
                  onClick={() => onTransactionTap(tx)}
                  className="relative z-10 p-5 rounded-[2rem] backdrop-blur-xl border shadow-sm bg-white/80 dark:bg-slate-900/80 border-slate-200/40 dark:border-slate-700/40 cursor-pointer hover:bg-white/90 dark:hover:bg-slate-900/90 active:scale-[0.98] transition-all w-full text-left"
                  aria-label={`Transaction: ${tx.vendor}, ${tx.amount.toFixed(2)} dollars`}
                >
                  <div className="flex items-center justify-between">
                    {/* Budget icon with color accent */}
                    {budget && (
                      <div
                        className="flex-shrink-0 mr-3 p-2 rounded-xl relative overflow-hidden"
                        style={{ backgroundColor: color ? `${color.primary}15` : undefined }}
                      >
                        <div style={{ color: color?.primary || '#64748b' }}>
                          {getBudgetIcon(budget.name)}
                        </div>
                      </div>
                    )}

                    <div className="flex flex-col text-left flex-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className="font-black text-[14px] text-slate-500 dark:text-slate-100 tracking-tight leading-none uppercase truncate">
                          {tx.vendor}
                        </span>
                        {isSharedAccount && tx.userName && (
                          <span
                            className={`text-[9px] font-black px-2 py-0.5 rounded-full tracking-widest ${
                              tx.userName !== currentUserName
                                ? 'bg-emerald-950 text-emerald-400'
                                : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            }`}
                          >
                            {tx.userName.split(' ')[0]}
                          </span>
                        )}
                      </div>

                      {/* Date + tags */}
                      <div className="flex items-center flex-wrap gap-1.5 mt-1.5">
                        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-tight">
                          {new Date(tx.date).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>

                        {/* AI tag */}
                        {tx.label === 'Auto-Added' && (
                          <span
                            className="text-[8px] font-black uppercase tracking-[0.12em] px-1.5 py-0.5 rounded-md"
                            style={{
                              backgroundColor: color ? `${color.primary}18` : 'rgba(16,185,129,0.1)',
                              color: color?.primary || '#10b981',
                            }}
                          >
                            AI
                          </span>
                        )}

                        {/* Recurring tag with frequency */}
                        {tx.recurrence && tx.recurrence !== 'One-time' && (
                          <span
                            className="text-[8px] font-black uppercase tracking-[0.12em] px-1.5 py-0.5 rounded-md flex items-center gap-0.5"
                            style={{
                              backgroundColor: color ? `${color.primary}18` : 'rgba(100,116,139,0.1)',
                              color: color?.primary || '#64748b',
                            }}
                          >
                            <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                              <path d="M17 2l4 4-4 4" />
                              <path d="M3 11v-1a4 4 0 014-4h14" />
                              <path d="M7 22l-4-4 4-4" />
                              <path d="M21 13v1a4 4 0 01-4 4H3" />
                            </svg>
                            {tx.recurrence}
                          </span>
                        )}

                        {/* Projected tag */}
                        {tx.is_projected && (
                          <span className="text-[8px] font-black text-amber-500 dark:text-amber-400 uppercase tracking-[0.12em] bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded-md">
                            Projected
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Amount */}
                    <div className="text-right flex-shrink-0 ml-2">
                      <div
                        className={`text-lg font-black tracking-tighter ${
                          tx.is_projected
                            ? 'text-slate-300 dark:text-slate-700'
                            : 'text-slate-500 dark:text-slate-50'
                        }`}
                      >
                        ${tx.amount.toFixed(2)}
                      </div>
                      {tx.splits && tx.splits.length > 0 && (
                        <div className="text-[8px] text-emerald-600 dark:text-emerald-400 font-black uppercase tracking-[0.2em] mt-0.5">
                          Split
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              </div>
            );
          })
        ) : (
          <div className="pt-16 text-center">
            <p className="text-[11px] font-black uppercase tracking-[0.25em] text-slate-300 dark:text-slate-600">
              No transactions
            </p>
            <p className="text-[10px] font-medium text-slate-400 dark:text-slate-500 mt-2">
              {activeFilter === 'past'
                ? 'No past transactions found.'
                : activeFilter === 'future'
                  ? 'No upcoming transactions.'
                  : 'Add your first transaction to get started.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default DashboardTransactionList;

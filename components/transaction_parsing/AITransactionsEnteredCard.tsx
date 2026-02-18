import React from 'react';
import { Transaction, BudgetCategory } from '../../types';
import ParsingCard from '../ui/ParsingCard';
import { EmptyState } from '../shared';
import { getBudgetIcon } from '../dashboard_components/getBudgetIcon';
import { parseLocalDate } from '../../lib/dateUtils';

interface AITransactionsEnteredCardProps {
  /** AI-entered transactions (label === 'AI') */
  aiTransactions: Transaction[];
  budgets: BudgetCategory[];
  onTransactionTap?: (tx: Transaction) => void;
  onClear?: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

/**
 * Shows all transactions that the AI successfully processed and entered.
 * These are real purchases/charges that passed duplicate detection and
 * non-transaction filtering.
 */
const AITransactionsEnteredCard: React.FC<AITransactionsEnteredCardProps> = ({
  aiTransactions,
  budgets,
  onTransactionTap,
  onClear,
  onRefresh,
  isRefreshing = false,
}) => {
  const budgetNameById = new Map<string, string>(budgets.map(b => [b.id, b.name]));

  return (
    <ParsingCard
      id="parsing-ai-entered"
      colorScheme="emerald"
      icon={
        <>
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </>
      }
      title="Caught Transactions"
      subtitle="AI-processed transactions added to your budgets"
      count={aiTransactions.length}
      headerAction={
        <div className="flex items-center gap-1">
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="p-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
            title="Scan for new transactions"
            aria-label="Scan for new transactions"
          >
            <svg
              className={`w-4 h-4 text-emerald-500 dark:text-emerald-400 ${isRefreshing ? 'animate-spin' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
          </button>
          <button
            onClick={onClear}
            className="p-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
            title="Clear entered"
            aria-label="Clear all entered transactions"
          >
            <svg className="w-4 h-4 text-slate-400 dark:text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>
        </div>
      }
    >
      {aiTransactions.length > 0 ? (
        <div className="space-y-2">
          {aiTransactions.map((tx) => {
            const budgetName = tx.budget_id ? (budgetNameById.get(tx.budget_id) || null) : null;

            return (
              <button
                key={tx.id}
                onClick={() => onTransactionTap?.(tx)}
                className="w-full flex items-center justify-between p-4 bg-emerald-50/50 dark:bg-emerald-900/10 rounded-2xl border border-emerald-100 dark:border-emerald-800/30 transition-all active:scale-[0.98] cursor-pointer text-left"
              >
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center">
                    {budgetName ? (
                      <span className="text-emerald-600 dark:text-emerald-400 w-4 h-4">
                        {getBudgetIcon(budgetName)}
                      </span>
                    ) : (
                      <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>
                  <div className="text-left min-w-0">
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate max-w-[160px]">
                      {tx.vendor}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {budgetName && (
                        <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                          {budgetName}
                        </span>
                      )}
                      <span className="text-[9px] text-slate-400 dark:text-slate-500">
                        {parseLocalDate(tx.date).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-sm font-black text-slate-700 dark:text-slate-200">
                    ${tx.amount.toFixed(2)}
                  </span>
                  <p className="text-[8px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mt-0.5">
                    AI
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={
            <svg className="w-6 h-6 text-slate-300 dark:text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          }
          message="No AI transactions yet"
          description="Transactions will appear here as Covault AI processes your bank notifications."
          size="md"
        />
      )}
    </ParsingCard>
  );
};

export default AITransactionsEnteredCard;

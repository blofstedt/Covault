import React, { useMemo } from 'react';
import { BudgetCategory, Transaction } from '../../types';
import { getBudgetColor } from '../../lib/budgetColors';

interface MonthlyPulseCardProps {
  budgets: BudgetCategory[];
  transactions: Transaction[];
  theme?: 'light' | 'dark';
}

const MonthlyPulseCard: React.FC<MonthlyPulseCardProps> = ({ budgets, transactions, theme = 'light' }) => {
  const { totalSpent, totalLimit, remaining, topCategory, topCategorySpent, topColor } = useMemo(() => {
    const spendByBudget = new Map<string, number>();

    for (const tx of transactions) {
      if (tx.is_projected) continue;
      const bid = tx.budget_id;
      if (bid) {
        spendByBudget.set(bid, (spendByBudget.get(bid) || 0) + tx.amount);
      }
    }

    let totalSpent = 0;
    let totalLimit = 0;
    let topCategory = '';
    let topCategorySpent = 0;
    let topColor = '';

    for (const b of budgets) {
      const spent = spendByBudget.get(b.id) || 0;
      totalSpent += spent;
      totalLimit += b.totalLimit;
      if (spent > topCategorySpent) {
        topCategorySpent = spent;
        topCategory = b.name;
        topColor = getBudgetColor(b.name);
      }
    }

    return {
      totalSpent,
      totalLimit,
      remaining: totalLimit - totalSpent,
      topCategory,
      topCategorySpent,
      topColor,
    };
  }, [budgets, transactions]);

  if (totalLimit === 0) return null;

  const isOver = remaining < 0;
  const absRemaining = Math.abs(remaining);

  return (
    <div className="px-4 mb-2">
      <div
        className={`flex items-center gap-3 px-4 py-3 rounded-2xl border transition-colors duration-300 ${
          theme === 'dark'
            ? 'bg-slate-900/60 border-slate-800/50'
            : 'bg-white/60 border-slate-200/40'
        }`}
      >
        {/* Colored dot */}
        <div
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: isOver ? '#f59e0b' : '#10b981' }}
        />

        {/* Text */}
        <div className="flex-1 min-w-0">
          <p className={`text-xs font-medium leading-snug ${
            theme === 'dark' ? 'text-slate-300' : 'text-slate-600'
          }`}>
            {isOver ? (
              <>You've used <span className="font-bold font-mono text-amber-500">${absRemaining.toFixed(0)}</span> over your total budget</>
            ) : (
              <>You have <span className="font-bold font-mono text-emerald-600 dark:text-emerald-400">${absRemaining.toFixed(0)}</span> left this month</>
            )}
          </p>
          {topCategory && (
            <p className={`text-[10px] mt-0.5 ${
              theme === 'dark' ? 'text-slate-500' : 'text-slate-400'
            }`}>
              <span className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle" style={{ backgroundColor: topColor }} />
              {topCategory} is your biggest at ${topCategorySpent.toFixed(0)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default MonthlyPulseCard;

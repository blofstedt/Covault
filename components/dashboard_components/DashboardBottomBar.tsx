import React from 'react';
import { BudgetCategory } from '../../types';
import { getBudgetIcon } from './getBudgetIcon';

interface DashboardBottomBarProps {
  budgets: BudgetCategory[];
  expandedBudgets: Set<string>;
  onJumpToBudget: (id: string) => void;
  onAddTransaction: () => void;
}

const DashboardBottomBar: React.FC<DashboardBottomBarProps> = ({
  budgets,
  expandedBudgets,
  onJumpToBudget,
  onAddTransaction
}) => {
  const midpoint = Math.ceil(budgets.length / 2);
  const firstHalfBudgets = budgets.slice(0, midpoint);
  const secondHalfBudgets = budgets.slice(midpoint);

  return (
    <div
      id="bottom-bar"
      className="fixed bottom-0 left-0 right-0 z-40 px-4 pb-4 pt-2 flex flex-col items-center pointer-events-none pb-safe"
    >
      <div
        className="w-full backdrop-blur-3xl border rounded-full px-3 py-2 pointer-events-auto shadow-2xl animate-nest transition-all duration-700 bg-white/95 dark:bg-slate-900/95 border-slate-100 dark:border-slate-800/60"
        style={{ animationDelay: '0.4s' }}
      >
        <div className="flex items-center justify-evenly">
          {firstHalfBudgets.map((b) => (
            <button
              key={b.id}
              onClick={() => onJumpToBudget(b.id)}
              className={`p-2 rounded-full transition-all duration-300 ${
                expandedBudgets.has(b.id)
                  ? 'bg-emerald-600 text-white shadow-lg scale-110'
                  : 'text-slate-400 dark:text-slate-600'
              }`}
            >
              {getBudgetIcon(b.name)}
            </button>
          ))}

          <button
            id="add-transaction-button"
            onClick={onAddTransaction}
            className="p-3 text-white rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-all bg-slate-500 dark:bg-emerald-600"
          >
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>

          {secondHalfBudgets.map((b) => (
            <button
              key={b.id}
              onClick={() => onJumpToBudget(b.id)}
              className={`p-2 rounded-full transition-all duration-300 ${
                expandedBudgets.has(b.id)
                  ? 'bg-emerald-600 text-white shadow-lg scale-110'
                  : 'text-slate-400 dark:text-slate-600'
              }`}
            >
              {getBudgetIcon(b.name)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default DashboardBottomBar;

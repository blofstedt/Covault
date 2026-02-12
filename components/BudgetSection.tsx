// components/BudgetSection.tsx
import React from 'react';
import { BudgetCategory, Transaction } from '../types';
import TransactionItem from './TransactionItem';
import { getBudgetIcon } from './dashboard_components/getBudgetIcon';
import { Shield } from 'lucide-react';

interface ExtendedBudgetCategory extends BudgetCategory {
  externalDeduction?: number;
}

interface BudgetSectionProps {
  budget: ExtendedBudgetCategory;
  transactions: Transaction[];
  isExpanded: boolean;
  onToggle: () => void;
  onUpdateBudget: (b: BudgetCategory) => void;
  onTransactionTap: (tx: Transaction) => void;
  currentUserName: string;
  isSharedView: boolean;
  allBudgets?: BudgetCategory[];
}

const BudgetSection: React.FC<BudgetSectionProps> = ({
  budget,
  transactions,
  isExpanded,
  onToggle,
  onUpdateBudget,
  onTransactionTap,
  currentUserName,
  isSharedView,
  allBudgets,
}) => {

  const getAmountForThisBudget = (tx: Transaction) => {
    if (tx.splits && tx.splits.length > 0) {
      const split = tx.splits.find((s) => s.budget_id === budget.id);
      return split ? split.amount : 0;
    }
    return tx.budget_id === budget.id ? tx.amount : 0;
  };

  const spent = transactions.reduce(
    (acc, tx) => acc + (tx.is_projected ? 0 : getAmountForThisBudget(tx)),
    0,
  );

  const projected = transactions.reduce(
    (acc, tx) => acc + (tx.is_projected ? getAmountForThisBudget(tx) : 0),
    0,
  );

  const external = budget.externalDeduction || 0;
  const total = spent + external + projected;
  const isDanger = total > budget.totalLimit;

  const spentWidth = Math.min(
    100,
    budget.totalLimit > 0 ? (spent / budget.totalLimit) * 100 : 0,
  );
  const externalWidth = Math.min(
    100 - spentWidth,
    budget.totalLimit > 0 ? (external / budget.totalLimit) * 100 : 0,
  );
  const projectedWidth = Math.min(
    100 - spentWidth - externalWidth,
    budget.totalLimit > 0 ? (projected / budget.totalLimit) * 100 : 0,
  );

  return (
    <div
      className={`flex-1 h-full overflow-hidden transition-all duration-[300ms] rounded-[2rem] border relative flex flex-col bg-white dark:bg-slate-900 ${
        isExpanded
          ? 'ease-in border-emerald-300 dark:border-emerald-800 shadow-2xl'
          : 'ease-out border-slate-100 dark:border-slate-800/60 shadow-sm'
      }`}
    >
      {/* CLEAN BACKGROUND BARS (NO WAVES / ANIMATIONS) */}
      <div className="absolute inset-0 z-0 pointer-events-none flex">
        {/* Spent */}
        <div
          style={{ width: `${spentWidth}%` }}
          className="h-full bg-emerald-400/30 dark:bg-emerald-500/40 transition-all duration-300"
        />

        {/* Shield (External Deduction) - Dark Green */}
        {external > 0 && (
          <div
            style={{ width: `${externalWidth}%` }}
            className="h-full bg-emerald-800/50 dark:bg-emerald-900/60 transition-all duration-300 relative flex items-center justify-center"
          >
            <Shield 
              className="text-emerald-900/40 dark:text-emerald-700/50 absolute" 
              size={isExpanded ? 28 : 16}
              strokeWidth={2.5}
            />
          </div>
        )}

        {/* Projected - with fine slanted lines /// */}
        <div
          style={{ width: `${projectedWidth}%` }}
          className="h-full transition-all duration-300 relative"
        >
          {/* Base color layer */}
          <div className="absolute inset-0 bg-emerald-500/10 dark:bg-emerald-800/20" />
          {/* Fine slanted lines overlay pattern /// */}
          <div 
            className="absolute inset-0 bg-repeat"
            style={{
              backgroundImage: `repeating-linear-gradient(
                45deg,
                transparent,
                transparent 3px,
                rgba(16, 185, 129, 0.3) 3px,
                rgba(16, 185, 129, 0.3) 4px
              )`
            }}
          />
        </div>
      </div>

      {/* HEADER / SUMMARY */}
      <div
        onClick={onToggle}
        className={`relative z-10 flex-1 flex items-center justify-between cursor-pointer active:scale-[0.99] transition-all ${
          isExpanded ? 'flex-none py-10 px-8' : 'py-2 px-6'
        }`}
      >
        {/* LEFT SIDE: ICON + NAME */}
        <div className="flex items-center space-x-4">
          <div
            className={`p-2 rounded-2xl transition-all duration-300 ${
              isExpanded
                ? 'bg-emerald-600 text-white shadow-lg scale-110 p-3.5'
                : 'bg-white/80 dark:bg-slate-800 text-slate-400 dark:text-slate-500 shadow-sm'
            }`}
          >
            {getBudgetIcon(budget.name)}
          </div>

          <div className="flex flex-col text-left">
            <h3 className="text-sm font-black tracking-tight leading-none uppercase transition-colors duration-300 text-slate-500 dark:text-slate-100">
              {budget.name}
            </h3>

            {!isExpanded && (
              <span
                className="text-[10px] font-black uppercase tracking-[0.15em] mt-1 transition-colors duration-300 text-slate-400 dark:text-slate-500"
              >
                {isDanger
                  ? `Over: $${Math.max(0, total - budget.totalLimit).toFixed(0)}`
                  : `$${Math.max(0, budget.totalLimit - total).toFixed(0)} left`}
              </span>
            )}
          </div>
        </div>

        {/* RIGHT SIDE: SPENT / LIMIT */}
        <div className="text-right flex flex-col items-end justify-center">
          {isExpanded ? (
            <>
              <div className="flex items-baseline space-x-1">
                <div className="flex flex-col items-end">
                  <span
                    className="text-sm font-black mr-2 tracking-tight transition-colors duration-300 text-slate-500"
                  >
                    ${spent.toFixed(0)}
                    {projected > 0 && (
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {' '}+${projected.toFixed(0)}
                      </span>
                    )}
                    {external > 0 && (
                      <span className="text-amber-500 dark:text-amber-400">
                        {' '}+${external.toFixed(0)}
                      </span>
                    )}
                    <span className="mx-1.5 opacity-30 font-medium text-slate-400">
                      /
                    </span>
                  </span>
                  {(projected > 0 || external > 0) && (
                    <span className="text-[8px] font-bold uppercase tracking-wider mr-2">
                      {projected > 0 && (
                        <span className="text-emerald-600 dark:text-emerald-400">
                          Projected
                        </span>
                      )}
                      {projected > 0 && external > 0 && (
                        <span className="text-slate-400 dark:text-slate-500">
                          {' + '}
                        </span>
                      )}
                      {external > 0 && (
                        <span className="text-amber-500 dark:text-amber-400">
                          Shield Active
                        </span>
                      )}
                    </span>
                  )}
                </div>
                <span
                  className="text-sm font-black mr-2 tracking-tight transition-colors duration-300 text-slate-500"
                >
                  ${total.toFixed(0)}
                  <span className="mx-1.5 opacity-30 font-medium text-slate-400">
                    /
                  </span>
                </span>

                <span className="text-xl font-black tracking-tighter leading-none transition-colors duration-300 text-slate-500 dark:text-slate-100">
                  ${budget.totalLimit}
                </span>
              </div>

              <span
                className="text-[10px] font-bold uppercase tracking-widest mt-0.5 transition-colors duration-300 text-slate-400 dark:text-slate-500"
              >
                Vault Capacity
              </span>
            </>
          ) : (
            <span
              className="text-sm font-black tracking-tight transition-colors duration-300 text-slate-500 dark:text-slate-100"
              aria-label={`${budget.totalLimit} dollar budget`}
            >
              ${budget.totalLimit}
            </span>
          )}
        </div>
      </div>

      {/* EXPANDED TRANSACTIONS LIST */}
      {isExpanded && (
        <div 
          className="flex-1 overflow-y-auto no-scrollbar px-6 pb-12 animate-in fade-in slide-in-from-top-2 duration-500 relative z-10"
          onClick={(e) => {
            // If clicking on the blank space (the div itself), collapse the budget
            if (e.target === e.currentTarget) {
              onToggle();
            }
          }}
        >
          <div className="py-6 space-y-4">
            <div className="flex items-center justify-between px-2">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] transition-colors duration-300 text-slate-400 dark:text-slate-500">
                {isSharedView ? 'Our Activity History' : 'Activity History'}
              </span>
            </div>

            <div className="space-y-3">
              {transactions.length > 0 ? (
                transactions.map((tx) => (
                  <TransactionItem
                    key={tx.id}
                    transaction={tx}
                    onTap={onTransactionTap}
                    currentUserName={currentUserName}
                    isSharedView={isSharedView}
                    currentBudgetId={budget.id}
                    budgets={allBudgets}
                  />
                ))
              ) : (
                <div className="py-16 text-center text-[11px] font-black uppercase tracking-widest text-slate-200 dark:text-slate-800">
                  No entries found
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BudgetSection;

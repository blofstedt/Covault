// components/BudgetSection.tsx
import React from 'react';
import { BudgetCategory, Transaction } from '../types';
import TransactionItem from './TransactionItem';
import { getBudgetIcon } from './dashboard_components/getBudgetIcon';
import { EmptyState } from './shared';
import { getBudgetColor } from '../lib/budgetColors';

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
  // Include external (shield) deduction directly in the consumed total
  const spentWithExternal = spent + external;
  const total = spentWithExternal + projected;
  const isDanger = total > budget.totalLimit;

  const spentWidth = Math.min(
    100,
    budget.totalLimit > 0 ? (spentWithExternal / budget.totalLimit) * 100 : 0,
  );
  const projectedWidth = Math.min(
    100 - spentWidth,
    budget.totalLimit > 0 ? (projected / budget.totalLimit) * 100 : 0,
  );

  const budgetColor = getBudgetColor(budget.name);

  return (
    <div
      className={`flex-1 h-full overflow-hidden rounded-[2rem] border relative flex flex-col bg-white dark:bg-slate-900 ${
        isExpanded
          ? 'shadow-2xl'
          : 'border-slate-100 dark:border-slate-800/60 shadow-sm'
      }`}
      style={{
        borderColor: isExpanded ? budgetColor : undefined,
        transition: 'all 0.5s cubic-bezier(0.32, 0.72, 0, 1)',
      }}
    >
      {/* CLEAN BACKGROUND BARS (NO WAVES / ANIMATIONS) */}
      <div className="absolute inset-0 z-0 pointer-events-none flex">
        {/* Spent (includes shield/external deduction) — filled with budget color at 50% opacity and brighter stroke */}
        <div
          style={{
            width: `${spentWidth}%`,
            backgroundColor: `${budgetColor}80`,
            borderRight: spentWidth > 0 && spentWidth < 100 ? `2px solid ${budgetColor}` : 'none',
          }}
          className="h-full transition-all duration-300"
        />

        {/* Projected - with fine slanted lines /// using budget color */}
        <div
          style={{ width: `${projectedWidth}%` }}
          className="h-full transition-all duration-300 relative"
        >
          {/* Base color layer */}
          <div className="absolute inset-0" style={{ backgroundColor: `${budgetColor}1A` }} />
          {/* Fine slanted lines overlay pattern /// */}
          <div 
            className="absolute inset-0 bg-repeat"
            style={{
              backgroundImage: `repeating-linear-gradient(
                45deg,
                transparent,
                transparent 3px,
                ${budgetColor}4D 3px,
                ${budgetColor}4D 4px
              )`
            }}
          />
        </div>
      </div>

      {/* HEADER / SUMMARY */}
      <div
        onClick={onToggle}
        className={`relative z-10 flex-1 flex items-center justify-between cursor-pointer active:scale-[0.99] ${
          isExpanded ? 'flex-none py-10 px-8' : 'py-2 px-6'
        }`}
        style={{
          transition: 'all 0.5s cubic-bezier(0.32, 0.72, 0, 1)',
        }}
      >
        {/* LEFT SIDE: ICON + NAME */}
        <div className="flex items-center space-x-4">
          <div
            className={`p-2 rounded-2xl transition-all duration-300 ${
              isExpanded
                ? 'text-white shadow-lg scale-110 p-3.5'
                : 'bg-white/80 dark:bg-slate-800 shadow-sm'
            }`}
            style={isExpanded
              ? { backgroundColor: budgetColor }
              : { color: budgetColor }
            }
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
          className="flex-1 overflow-y-auto no-scrollbar px-6 pb-12 relative z-10"
          style={{
            animation: 'budgetContentReveal 0.5s cubic-bezier(0.32, 0.72, 0, 1) forwards',
          }}
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
                <EmptyState message="No entries found" size="md" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BudgetSection;

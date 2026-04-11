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
  useCompactCollapsedStyles?: boolean;
}

const BudgetSection: React.FC<BudgetSectionProps> = ({
  budget,
  transactions,
  isExpanded,
  onToggle,
  onUpdateBudget: _onUpdateBudget,
  onTransactionTap,
  currentUserName,
  isSharedView,
  allBudgets,
  useCompactCollapsedStyles = false,
}) => {

  const getAmountForThisBudget = (tx: Transaction) => {
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

  // Danger escalation: color shifts as spending approaches/exceeds limit
  const spentPercent = budget.totalLimit > 0 ? (total / budget.totalLimit) * 100 : 0;
  const isWarning = spentPercent > 80 && spentPercent <= 100;
  const isOver = spentPercent > 100;

  return (
    <div
      className={`flex-1 h-full min-h-0 overflow-hidden rounded-[2rem] relative flex flex-col ${
        isExpanded
          ? 'bg-white dark:bg-slate-900 shadow-2xl border'
          : 'bg-white/70 dark:bg-slate-900/70 shadow-sm border border-slate-200/40 dark:border-slate-700/30'
      }`}
      style={{
        borderColor: isExpanded
          ? budgetColor
          : undefined,
        transition: isExpanded
          ? 'border-color 0.5s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.5s cubic-bezier(0.22, 1, 0.36, 1)'
          : 'border-color 0.3s cubic-bezier(0.4, 0, 1, 1), box-shadow 0.3s cubic-bezier(0.4, 0, 1, 1)',
      }}
    >
      {/* GRADIENT BACKGROUND BARS WITH GLOW EDGE */}
      <div className="absolute inset-0 z-0 pointer-events-none flex">
        {/* Spent bar — gradient fill with glow edge at boundary */}
        <div
          style={{
            width: `${spentWidth}%`,
            background: `linear-gradient(90deg, ${budgetColor}55 0%, ${budgetColor}70 100%)`,
          }}
          className="h-full transition-all duration-500 ease-out relative"
        >
          {/* Glow edge at spending boundary */}
          {spentWidth > 0 && spentWidth < 100 && (
            <div
              className="absolute right-0 top-0 h-full w-[3px] transition-all duration-500"
              style={{
                background: budgetColor,
                boxShadow: `0 0 6px ${budgetColor}50, 0 0 12px ${budgetColor}20`,
              }}
            />
          )}
        </div>

        {/* Projected — dot-grid pattern */}
        <div
          style={{ width: `${projectedWidth}%` }}
          className="h-full transition-all duration-500 ease-out relative"
        >
          <div className="absolute inset-0" style={{ backgroundColor: `${budgetColor}12` }} />
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `radial-gradient(circle, ${budgetColor}30 1px, transparent 1px)`,
              backgroundSize: '6px 6px',
            }}
          />
        </div>
      </div>

      {/* Thin accent progress bar removed — the gradient fill IS the bar */}

      {/* HEADER / SUMMARY */}
      <div
        onClick={onToggle}
        className={`relative z-10 flex-1 flex items-center justify-between cursor-pointer active:scale-[0.99] ${
          isExpanded
            ? 'flex-none py-10 px-8'
            : useCompactCollapsedStyles
              ? 'py-1.5 px-3'
              : 'py-2 px-4'
        }`}
        style={{
          transition: isExpanded
            ? 'padding 0.5s cubic-bezier(0.22, 1, 0.36, 1), flex 0.5s cubic-bezier(0.22, 1, 0.36, 1)'
            : 'padding 0.3s cubic-bezier(0.4, 0, 1, 1), flex 0.3s cubic-bezier(0.4, 0, 1, 1)',
        }}
      >
        {/* LEFT SIDE: ICON + NAME */}
        <div className={`flex items-center ${useCompactCollapsedStyles && !isExpanded ? 'space-x-2' : 'space-x-3'}`}>
          <div
            className={`rounded-2xl flex items-center justify-center shrink-0 ${
              isExpanded
                ? 'text-white shadow-lg p-3.5'
                : useCompactCollapsedStyles
                  ? 'p-1'
                  : 'p-1.5'
            }`}
            style={{
              ...(isExpanded
                ? { backgroundColor: budgetColor }
                : { color: budgetColor }),
              transition: 'padding 0.3s cubic-bezier(0.22, 1, 0.36, 1), background-color 0.3s ease, color 0.3s ease, box-shadow 0.3s ease',
            }}
          >
            {getBudgetIcon(budget.name)}
          </div>

          <div className="flex flex-col text-left">
            <h3 className={`font-bold tracking-tight leading-none transition-colors duration-300 text-slate-600 dark:text-slate-100 ${useCompactCollapsedStyles && !isExpanded ? 'text-[12px]' : 'text-sm'}`}>
              {budget.name}
            </h3>

            {!isExpanded && (
              <span
                className={`font-bold tracking-wide mt-1 transition-colors duration-300 ${
                  isOver
                    ? 'text-rose-500 dark:text-rose-400'
                    : isWarning
                      ? 'text-amber-500 dark:text-amber-400'
                      : 'text-slate-400 dark:text-slate-500'
                } ${useCompactCollapsedStyles ? 'text-[9px]' : 'text-[10px]'}`}
              >
                {isDanger
                  ? `Over by $${Math.max(0, total - budget.totalLimit).toFixed(0)}`
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
                  className="text-sm font-bold font-mono mr-2 tracking-tight transition-colors duration-300 text-slate-500"
                >
                  ${total.toFixed(0)}
                  <span className="mx-1.5 opacity-30 font-medium text-slate-400">
                    /
                  </span>
                </span>

                <span className="text-xl font-extrabold font-mono tracking-tighter leading-none transition-colors duration-300 text-slate-600 dark:text-slate-100">
                  ${budget.totalLimit}
                </span>
              </div>

              <span
                className="text-[10px] font-medium tracking-wide mt-0.5 transition-colors duration-300 text-slate-400 dark:text-slate-500"
              >
                Vault Capacity
              </span>
            </>
          ) : (
            <span
              className={`font-black tracking-tight transition-colors duration-300 text-slate-500 dark:text-slate-100 ${useCompactCollapsedStyles ? 'text-xs' : 'text-sm'}`}
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
          className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-6 pb-12 relative z-10"
          style={{
            animation: 'budgetContentReveal 0.45s cubic-bezier(0.22, 1, 0.36, 1) forwards',
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
              <span className="text-[10px] font-semibold tracking-wide transition-colors duration-300 text-slate-400 dark:text-slate-500">
                {isSharedView ? 'Our Activity' : 'Activity'}
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

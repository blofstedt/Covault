// components/BudgetSection.tsx
import React, { useMemo, useCallback, memo } from 'react';
import { BudgetCategory, Transaction } from '../types';
import TransactionItem from './TransactionItem';
import { getBudgetIcon } from './dashboard_components/getBudgetIcon';
import { EmptyState } from './shared';
import { getBudgetColor } from '../lib/budgetColors';
import { isRefund, matchRefundsToExpenses } from '../lib/refundMatching';

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
  const { matchedExpenseIds: legacyMatchedIds, unmatchedRefunds } = useMemo(
    () => matchRefundsToExpenses(transactions),
    [transactions],
  );

  const { refundedExpenseIds, spent, projected, visibleTransactions } = useMemo(() => {
    const ids = new Set<string>(legacyMatchedIds);
    let calcSpent = 0;
    let calcProjected = 0;
    const visibleTx: Transaction[] = [];

    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i];

      if (tx.refunded) ids.add(tx.id);
      if (!isRefund(tx)) visibleTx.push(tx);

      if (tx.budget_id === budget.id) {
        if (tx.is_projected) {
          calcProjected += tx.amount;
        } else if (!tx.refunded && !(ids.has(tx.id) && Number(tx.amount) > 0)) {
          calcSpent += tx.amount;
        }
      }
    }

    return {
      refundedExpenseIds: ids,
      spent: calcSpent,
      projected: calcProjected,
      visibleTransactions: visibleTx,
    };
  }, [legacyMatchedIds, transactions, budget.id]);

  const _hasUnmatchedRefunds = unmatchedRefunds.length > 0;
  void _hasUnmatchedRefunds;

  const external = budget.externalDeduction || 0;
  const spentWithExternal = spent + external;
  const total = spentWithExternal + projected;
  const isDanger = total > budget.totalLimit;

  const spentWidth = Math.min(
    100,
    budget.totalLimit > 0 ? (Math.max(0, spentWithExternal) / budget.totalLimit) * 100 : 0,
  );
  const projectedWidth = Math.min(
    100 - spentWidth,
    budget.totalLimit > 0 ? (Math.max(0, projected) / budget.totalLimit) * 100 : 0,
  );

  const budgetColor = getBudgetColor(budget.name);

  const spentPercent = budget.totalLimit > 0 ? (total / budget.totalLimit) * 100 : 0;
  const isWarning = spentPercent > 80 && spentPercent <= 100;
  const isOver = spentPercent > 100;

  const handleBackgroundClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) {
        onToggle();
      }
    },
    [onToggle]
  );

  return (
    <div
      className={`flex-1 min-h-0 overflow-hidden rounded-[2rem] relative flex flex-col transition-all duration-300 ease-in-out ${
        isExpanded
          ? 'bg-white dark:bg-slate-900 shadow-2xl border'
          : 'bg-white/70 dark:bg-slate-900/70 shadow-sm border border-slate-200/40 dark:border-slate-700/30'
      }`}
      style={{
        borderColor: isExpanded ? budgetColor : undefined,
      }}
    >
      {/* GRADIENT BACKGROUND BARS WITH GLOW EDGE */}
      <div className="absolute inset-0 z-0 pointer-events-none flex">
        <div
          style={{
            width: `${spentWidth}%`,
            background: `linear-gradient(90deg, ${budgetColor}55 0%, ${budgetColor}70 100%)`,
          }}
          className="h-full transition-all duration-500 ease-out relative"
        >
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

      {/* HEADER / SUMMARY */}
      <div
        onClick={onToggle}
        className={`relative z-10 flex items-center justify-between cursor-pointer active:scale-[0.99] transition-all duration-300 ease-in-out ${
          isExpanded
            ? 'flex-none py-6 px-8'
            : useCompactCollapsedStyles
              ? 'flex-1 py-1.5 px-3'
              : 'flex-1 py-2 px-4'
        }`}
        style={{
          willChange: isExpanded ? 'auto' : 'transform, opacity, padding',
        }}
      >
        <div className={`flex items-center ${useCompactCollapsedStyles && !isExpanded ? 'space-x-2' : 'space-x-3'}`}>
          <div
            className={`rounded-2xl flex items-center justify-center shrink-0 transition-all duration-300 ease-in-out ${
              isExpanded
                ? 'text-white shadow-lg p-3.5'
                : useCompactCollapsedStyles
                  ? 'p-1'
                  : 'p-1.5'
            }`}
            style={{
              ...(isExpanded ? { backgroundColor: budgetColor } : { color: budgetColor }),
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
                className={`tracking-wide mt-1 transition-colors duration-300 ${
                  isOver
                    ? 'text-slate-700 dark:text-slate-100 font-extrabold'
                    : isWarning
                      ? 'text-slate-500 dark:text-slate-300 font-bold'
                      : 'text-slate-400 dark:text-slate-500 font-bold'
                } ${useCompactCollapsedStyles ? 'text-[10px]' : 'text-[11px]'}`}
              >
                {isDanger
                  ? `Over by $${Math.max(0, total - budget.totalLimit).toFixed(0)}`
                  : `$${Math.max(0, budget.totalLimit - total).toFixed(0)} left`}
              </span>
            )}
          </div>
        </div>

        <div className="text-right flex flex-col items-end justify-center">
          {isExpanded ? (
            <>
              <div className="flex items-baseline space-x-1">
                <span className="text-sm font-bold font-mono mr-2 tracking-tight transition-colors duration-300 text-slate-500">
                  ${total.toFixed(0)}
                  <span className="mx-1.5 opacity-30 font-medium text-slate-400">/</span>
                </span>

                <span className="text-xl font-extrabold font-mono tracking-tighter leading-none transition-colors duration-300 text-slate-600 dark:text-slate-100">
                  ${budget.totalLimit}
                </span>
              </div>

              <span className="text-[11px] font-medium tracking-wide mt-0.5 transition-colors duration-300 text-slate-400 dark:text-slate-500">
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

      {/* TRANSACTIONS LIST (Now stays mounted, styled to smoothly collapse) */}
      <div
        className={`min-h-0 overflow-y-auto no-scrollbar relative z-10 budget-content-reveal transition-all duration-300 ease-in-out transform origin-top ${
          isExpanded
            ? 'flex-1 opacity-100 translate-y-0 px-6 pb-2'
            : 'flex-none h-0 opacity-0 -translate-y-4 px-6 pb-0 overflow-hidden pointer-events-none'
        }`}
        style={{
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          overscrollBehaviorY: 'contain',
          overflowAnchor: 'none',
          touchAction: 'pan-y',
        }}
        onClick={handleBackgroundClick}
      >
        <div className="pt-1 pb-6 space-y-4">
          <div className="flex items-center justify-between px-2">
            <span className="text-[11px] font-semibold tracking-wide transition-colors duration-300 text-slate-400 dark:text-slate-500">
              {isSharedView ? 'Our Activity' : 'Activity'}
            </span>
          </div>

          <div className="space-y-3">
            {visibleTransactions.length > 0 ? (
              visibleTransactions.map((tx) => (
                <TransactionItem
                  key={tx.id}
                  transaction={tx}
                  onTap={onTransactionTap}
                  currentUserName={currentUserName}
                  isSharedView={isSharedView}
                  currentBudgetId={budget.id}
                  budgets={allBudgets}
                  isRefunded={refundedExpenseIds.has(tx.id)}
                />
              ))
            ) : (
              <EmptyState message="No entries found" size="md" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default memo(BudgetSection);

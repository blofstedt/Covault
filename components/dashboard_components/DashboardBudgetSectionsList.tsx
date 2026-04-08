import React, { useMemo } from 'react';
import { BudgetCategory, Transaction } from '../../types';
import BudgetSection from '../BudgetSection';

interface DashboardSettingsShape {
  useLeisureAsBuffer: boolean;
  [key: string]: any;
}

interface DashboardBudgetSectionsListProps {
  budgets: BudgetCategory[];
  transactions: Transaction[];
  expandedBudgets?: Set<string>;
  isFocusMode?: boolean;
  focusedBudgetId?: string | null;
  leisureAdjustments?: number;
  settings?: DashboardSettingsShape;
  currentUserName?: string;
  isSharedAccount?: boolean;
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  budgetRefs?: React.MutableRefObject<Map<string, HTMLDivElement>>;
  onToggleExpand?: (id: string) => void;
  onTransactionTap: (tx: Transaction) => void;
  onUpdateBudget: (b: BudgetCategory) => void;
}

const DashboardBudgetSectionsList: React.FC<DashboardBudgetSectionsListProps> = ({
  budgets,
  transactions,
  expandedBudgets = new Set<string>(),
  isFocusMode = false,
  focusedBudgetId = null,
  leisureAdjustments = 0,
  settings = { useLeisureAsBuffer: true },
  currentUserName = '',
  isSharedAccount = false,
  scrollContainerRef,
  budgetRefs,
  onToggleExpand,
  onTransactionTap,
  onUpdateBudget
}) => {
  const visibleBudgets = useMemo(() =>
    budgets
      .filter((budget) => !isFocusMode || budget.id === focusedBudgetId)
      .filter((budget) => {
        const hiddenCategories: string[] = settings.hiddenCategories || [];
        return !hiddenCategories.includes(budget.id);
      })
      .sort((a, b) => {
        const aIsOther = a.name.toLowerCase() === 'other';
        const bIsOther = b.name.toLowerCase() === 'other';
        if (aIsOther && !bIsOther) return 1;
        if (!aIsOther && bIsOther) return -1;
        return 0;
      }),
    [budgets, isFocusMode, focusedBudgetId, settings.hiddenCategories],
  );

  const expandedBudgetId = expandedBudgets.size > 0 ? Array.from(expandedBudgets)[0] : null;
  const allCollapsed = expandedBudgets.size === 0;

  return (
    <div
      ref={scrollContainerRef}
      className="flex-1 min-h-0 flex flex-col overflow-hidden mt-1 pb-24 no-scrollbar scroll-smooth h-full transition-all duration-500 gap-2"
    >
      {visibleBudgets.map((budget, index) => {
          const budgetTxs = transactions.filter(
            (t) =>
              t.budget_id === budget.id
          );

          const isExpanded = expandedBudgets.has(budget.id);
          const isLeisure = budget.name.toLowerCase().includes('leisure');

          const displayBudget =
            isLeisure && settings.useLeisureAsBuffer
              ? { ...budget, externalDeduction: leisureAdjustments }
              : budget;

          const shouldAutoFitClosedCards = allCollapsed && !isFocusMode;

          return (
            <div
              key={budget.id}
              id={index === 0 ? 'first-budget-card' : undefined}
              ref={(el) => {
                if (el) {
                  budgetRefs?.current.set(budget.id, el);
                } else {
                  budgetRefs?.current.delete(budget.id);
                }
              }}
              className={`flex flex-col transform-gpu ${
                expandedBudgetId
                  ? isExpanded
                    ? 'flex-1 min-h-0 opacity-100 scale-100 transition-[opacity,transform] duration-500 ease-out'
                    : 'flex-none h-0 opacity-0 scale-[0.97] overflow-hidden pointer-events-none transition-[opacity,transform,height] duration-300 ease-in'
                  : shouldAutoFitClosedCards
                    ? 'flex-1 basis-0 min-h-0 opacity-100 scale-100 transition-[opacity,transform] duration-500 ease-out'
                    : 'min-h-[84px] opacity-100 scale-100 transition-[opacity,transform] duration-500 ease-out'
              }`}
              style={{
                animationDelay: `${index * 40}ms`,
              }}
            >
              <BudgetSection
                budget={displayBudget}
                transactions={budgetTxs}
                isExpanded={isExpanded}
                onToggle={() => onToggleExpand?.(budget.id)}
                onUpdateBudget={onUpdateBudget}
                onTransactionTap={(tx) => onTransactionTap(tx)}
                currentUserName={currentUserName}
                isSharedView={isSharedAccount}
                allBudgets={budgets}
                useCompactCollapsedStyles={shouldAutoFitClosedCards}
              />
            </div>
          );
        })}

    </div>
  );
};

export default DashboardBudgetSectionsList;

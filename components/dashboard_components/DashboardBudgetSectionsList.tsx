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
  onUpdateBudget,
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
      className={`relative flex-1 min-h-0 mt-1 px-4 no-scrollbar flex flex-col ${
        expandedBudgetId
          ? 'overflow-hidden'
          : 'overflow-y-auto scroll-smooth gap-2 lg:grid lg:grid-cols-2 lg:auto-rows-fr'
      }`}
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
              className="flex-1 flex flex-col min-h-0 lg:min-h-[80px]"
              style={{
                // Smooth expansion: use max-height (a directly-animatable property)
                // rather than the `flex` shorthand. flex-grow/flex-shrink are integers
                // and snap rather than interpolate, and `flex-basis: auto` is a
                // computed value the browser can't always interpolate cleanly. The
                // previous transition on `flex` therefore looked choppy on the
                // expand → collapse boundary. flex-1 + max-height gives us a
                // smoothly-animatable height while still letting the expanded card
                // fill all available vertical space (max-height: 2000px is a
                // generous ceiling; the wrapper's flex-1 makes it take whatever
                // space remains after the collapsed cards collapse to 0).
                maxHeight: expandedBudgetId && !isExpanded ? '0px' : '2000px',
                opacity: expandedBudgetId && !isExpanded ? 0 : 1,
                overflow: 'hidden',
                pointerEvents: expandedBudgetId && !isExpanded ? 'none' : undefined,
                transition: 'max-height 0.42s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.28s ease',
                willChange: 'max-height, opacity',
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

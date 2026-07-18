import React, { useMemo } from 'react';
import { BudgetCategory, Transaction } from '../../types';
import BudgetSection from '../BudgetSection';

interface DashboardSettingsShape {
  useLeisureAsBuffer: boolean;
  hiddenCategories?: string[];
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
      className={`relative flex-1 min-h-0 px-4 no-scrollbar flex flex-col ${
        expandedBudgetId
          ? 'overflow-hidden'
          : 'overflow-y-auto scroll-smooth pt-3 pb-3 gap-3 lg:grid lg:grid-cols-2 lg:auto-rows-fr lg:pt-3 lg:pb-3'
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
              // Grid trick: outer grid is 1fr tall, inner row is 0fr → 1fr.
              // Animating grid-template-rows between 0fr and 1fr gives a
              // perfectly-smooth expand/collapse to natural content height
              // (no max-height guesswork, no choppy flex interpolation).
              // Slight overshoot via cubic-bezier gives an elastic ease-in-out.
              //
              // `flex-1` (in addition to the existing `lg:min-h-[80px]`)
              // makes the row grow to take an equal share of the flex
              // parent's available space. Combined with the container's
              // `gap-3` + `pt-3 pb-3` (see above) this gives the closed-
              // state vials an even distribution: equal padding between
              // each pair of vials, and equal padding between the chart
              // and the first vial / the last vial and the toolbar.
              className="flex-1 min-h-0 lg:min-h-[80px] grid budget-row-anim"
              style={{
                gridTemplateRows:
                  expandedBudgetId && !isExpanded ? '0fr' : '1fr',
                opacity: expandedBudgetId && !isExpanded ? 0 : 1,
                pointerEvents:
                  expandedBudgetId && !isExpanded ? 'none' : undefined,
                transition:
                  'grid-template-rows 0.55s cubic-bezier(0.34, 1.32, 0.64, 1), opacity 0.25s ease',
                willChange: 'grid-template-rows, opacity',
              }}
            >
              <div className="min-h-0 overflow-hidden flex-1 flex flex-col">
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
            </div>
          );
        })}

    </div>
  );
};

export default DashboardBudgetSectionsList;

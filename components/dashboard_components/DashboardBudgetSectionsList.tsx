import React from 'react';
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
  return (
    <div
      ref={scrollContainerRef}
      className={`flex-1 flex flex-col ${
        isFocusMode
          ? 'overflow-hidden'
          : expandedBudgets.size > 0
          ? 'overflow-y-auto'
          : 'overflow-hidden'
      } mt-1 pb-24 no-scrollbar scroll-smooth h-full transition-all duration-500 gap-2`}
    >
      {budgets
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
        })
        .map((budget, index) => {
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
              className={`flex flex-col ${
                isExpanded ? 'flex-[100] min-h-[70vh]' : 'flex-1 min-h-0'
              }`}
              style={{
                animationDelay: `${index * 40}ms`,
                transition: 'flex 0.5s cubic-bezier(0.32, 0.72, 0, 1), min-height 0.5s cubic-bezier(0.32, 0.72, 0, 1)',
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
              />
            </div>
          );
        })}

      {/* Spacer when some budgets are expanded and we're not in full focus mode */}
      {!isFocusMode && expandedBudgets.size > 0 && (
        <div className="h-[60vh] flex-none pointer-events-none" />
      )}
    </div>
  );
};

export default DashboardBudgetSectionsList;

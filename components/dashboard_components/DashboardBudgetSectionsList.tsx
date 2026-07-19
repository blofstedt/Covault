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
  settings,
  currentUserName = '',
  isSharedAccount = false,
  scrollContainerRef,
  budgetRefs,
  onToggleExpand,
  onTransactionTap,
  onUpdateBudget,
}) => {
  // The settings prop is optional, so we fall back to an empty shape.
  // (Default values on destructured params cause TS to infer the param
  // type as the default's type, ignoring the declared prop type — so
  // we handle the fallback in the body instead.)
  const safeSettings: DashboardSettingsShape = settings || { useLeisureAsBuffer: true };

  const visibleBudgets = useMemo(() =>
    budgets
      .filter((budget) => !isFocusMode || budget.id === focusedBudgetId)
      .filter((budget) => {
        const hiddenCategories: string[] = safeSettings.hiddenCategories || [];
        return !hiddenCategories.includes(budget.id);
      })
      .sort((a, b) => {
        const aIsOther = a.name.toLowerCase() === 'other';
        const bIsOther = b.name.toLowerCase() === 'other';
        if (aIsOther && !bIsOther) return 1;
        if (!aIsOther && bIsOther) return -1;
        return 0;
      }),
    [budgets, isFocusMode, focusedBudgetId, safeSettings.hiddenCategories],
  );

  const expandedBudgetId = expandedBudgets.size > 0 ? Array.from(expandedBudgets)[0] : null;
  const allCollapsed = expandedBudgets.size === 0;

  return (
    <div
      ref={scrollContainerRef}
      className={`relative flex-1 min-h-0 px-4 no-scrollbar flex flex-col ${
        expandedBudgetId
          ? 'overflow-hidden pt-3 pb-3 gap-3'
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

          // When a vial is the currently-expanded one it must take the
          // full available height of the list (i.e. everything between
          // the chart and the bottom toolbar). Any other row must shrink
          // out of the way. When everything is collapsed each row takes
          // an equal share of the available space.
          //
          // We set the flex longhand properties individually instead of
          // the `flex` shorthand so the browser transitions `flex-basis`
          // smoothly even when the other two flex properties also flip.
          // (`flex: 1 1 0%` ↔ `flex: 0 0 0%` is fine, but mixing the
          // shorthand with a different basis like `1 1 100%` can fail to
          // animate in some engines; the longhand form is bulletproof.)
          const rowFlexBasis = expandedBudgetId
            ? (isExpanded ? '100%' : '0%')
            : '0%';
          const rowFlexGrow = expandedBudgetId && !isExpanded ? 0 : 1;
          const rowFlexShrink = expandedBudgetId && !isExpanded ? 0 : 1;

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
              // Layout strategy
              // ---------------
              // Outer container is `flex flex-col` (or a 2-col grid on
              // desktop when everything is collapsed). Each row is a
              // flex item whose `flex` basis/grow we toggle:
              //   - all collapsed → `1 1 0%` (equal share, preserves the
              //     "evenly distribute closed vials" behavior).
              //   - one expanded  → that row `1 1 100%` (fills every
              //     remaining pixel of vertical space between chart and
              //     toolbar); the other rows go to `0 0 0%` (zero size
              //     so they don't push the expanded row down).
              //
              // Inside each row we keep the `grid-template-rows: 0fr ↔
              // 1fr` interpolation trick to animate the height of the
              // row's content. The trick is a modern, well-supported
              // way to animate to/from an `auto`/content height without
              // measuring it manually and without using a guessed
              // `max-height` — the browser interpolates the fractional
              // track size, so the animation stops cleanly at the
              // natural content height.
              //
              // Animation tuning
              // -----------------
              //  - Duration 0.32s — snappy enough to feel responsive,
              //    long enough to read as a deliberate motion.
              //  - Easing `cubic-bezier(0.32, 0.72, 0.24, 1)` — a
              //    standard "ease-out" shape. We deliberately avoid any
              //    curve with a y value > 1 ("overshoot") because the
              //    interpolated property here is a discrete track size;
              //    overshoot easing produces visible "snapping" at the
              //    end of the animation when the browser clamps to the
              //    final value.
              //  - The transition (defined in index.css on
              //    `.budget-row-anim`) covers `flex-basis`,
              //    `grid-template-rows`, and `opacity` on the same
              //    320ms clock so the row and the inner content bloom
              //    stay in sync.
              //  - We deliberately do NOT set `will-change` here. The
              //    transition is short (320ms) and modern browsers
              //    handle a 5–7 element list's worth of compositor
              //    promotion automatically; an explicit `will-change`
              //    would keep every row's compositor layer alive
              //    forever and waste GPU memory.
              className="min-h-0 grid budget-row-anim"
              style={{
                flexGrow: rowFlexGrow,
                flexShrink: rowFlexShrink,
                flexBasis: rowFlexBasis,
                // `0fr` for the rows being closed away from view, `1fr`
                // for the row that is staying (or has just become) the
                // open one — the grid-template-rows CSS animation
                // interpolates between the two.
                gridTemplateRows:
                  expandedBudgetId && !isExpanded ? '0fr' : '1fr',
                opacity: expandedBudgetId && !isExpanded ? 0 : 1,
                pointerEvents:
                  expandedBudgetId && !isExpanded ? 'none' : undefined,
              }}
            >
              <div className="min-h-0 overflow-hidden flex flex-col">
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

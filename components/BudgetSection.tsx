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
  /** Receives this section's budget id, so the parent can pass a single
   *  stable handler instead of allocating a fresh arrow per card per render. */
  onToggle: (budgetId: string) => void;
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
  onTransactionTap,
  currentUserName,
  isSharedView,
  allBudgets,
  useCompactCollapsedStyles = false,
}) => {
  const { matchedExpenseIds: legacyMatchedIds } = useMemo(
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

  const handleHeaderClick = useCallback(() => onToggle(budget.id), [onToggle, budget.id]);

  const handleBackgroundClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) {
        onToggle(budget.id);
      }
    },
    [onToggle, budget.id]
  );

  return (
    <div
      className={`flex-1 min-h-0 overflow-hidden rounded-[2rem] relative flex flex-col motion-safe:transition-[background-color,border-color,box-shadow] motion-safe:duration-[320ms] motion-safe:ease-[cubic-bezier(0.32,0.72,0.24,1)] ${
        isExpanded
          ? 'bg-white dark:bg-slate-900 shadow-2xl border'
          : 'bg-white/70 dark:bg-slate-900/70 shadow-sm border border-slate-200/40 dark:border-slate-700/30'
      }`}
      style={{
        borderColor: isExpanded ? budgetColor : undefined,
      }}
    >
      {/* GRADIENT BACKGROUND BARS WITH GLOW EDGE
          ---------------------------------------------------------
          The spent fill animates `transform: scaleX()` rather than `width`.
          Width is a layout property, so animating it re-laid-out this flex row
          on every frame, for every visible vial — the main mechanical cause of
          the jank here. A transform runs on the compositor instead.

          For that to be safe the fill has to have no children: scaleX would
          squash them horizontally. So the glow edge is now a SIBLING positioned
          at the fill's right edge, and it translates rather than scaling. The
          gradient itself is fine — it's defined over the element's box, so it
          scales exactly as it would have stretched.

          The projected bar keeps `width`: it carries a 6px dot pattern that
          scaleX would visibly distort, and it's the quieter of the two.

          Everything runs on the same 320ms curve as `.budget-row-anim` in
          index.css. These used to be 500ms against the row's 320ms and the
          card's 300ms — three clocks during a single expand, which is what
          read as "not smooth". */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div
          style={{
            transform: `scaleX(${Math.max(0, Math.min(100, spentWidth)) / 100})`,
            background: `linear-gradient(90deg, ${budgetColor}55 0%, ${budgetColor}70 100%)`,
          }}
          // No permanent `will-change`: the browser promotes for the duration
          // of a running transform transition and releases after. Pinning it
          // would keep a compositor layer alive for every vial forever — the
          // same reasoning as the note on `.budget-row-anim` in index.css.
          className="absolute inset-0 origin-left motion-safe:transition-transform motion-safe:duration-[320ms] motion-safe:ease-[cubic-bezier(0.32,0.72,0.24,1)]"
        />

        {spentWidth > 0 && spentWidth < 100 && (
          <div
            className="absolute top-0 h-full w-[3px] -ml-[3px] motion-safe:transition-[left] motion-safe:duration-[320ms] motion-safe:ease-[cubic-bezier(0.32,0.72,0.24,1)]"
            style={{
              left: `${spentWidth}%`,
              background: budgetColor,
              boxShadow: `0 0 6px ${budgetColor}50, 0 0 12px ${budgetColor}20`,
            }}
          />
        )}

        <div
          style={{
            left: `${spentWidth}%`,
            width: `${projectedWidth}%`,
          }}
          className="absolute top-0 h-full motion-safe:transition-[left,width] motion-safe:duration-[320ms] motion-safe:ease-[cubic-bezier(0.32,0.72,0.24,1)]"
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
        onClick={handleHeaderClick}
        className={`relative z-10 flex items-center justify-between cursor-pointer active:scale-[0.99] motion-safe:transition-[transform,padding] motion-safe:duration-[320ms] motion-safe:ease-[cubic-bezier(0.32,0.72,0.24,1)] ${
          isExpanded
            ? 'flex-none py-6 px-8'
            : useCompactCollapsedStyles
              ? 'flex-1 py-1.5 px-3'
              : 'flex-1 py-2 px-4'
        }`}
      >
        <div className={`flex items-center ${useCompactCollapsedStyles && !isExpanded ? 'space-x-2' : 'space-x-3'}`}>
          <div
            // `padding`, not `width,height`: the classes below change `p-*`,
            // so the old list named two properties this element never animates
            // and omitted the one it does — the chip snapped to its new size
            // mid-expand while everything around it eased.
            className={`rounded-2xl flex items-center justify-center shrink-0 motion-safe:transition-[padding,background-color] motion-safe:duration-[320ms] motion-safe:ease-[cubic-bezier(0.32,0.72,0.24,1)] ${
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
            <h3 className={`font-bold tracking-tight leading-none motion-safe:transition-colors motion-safe:duration-[320ms] text-slate-600 dark:text-slate-100 ${useCompactCollapsedStyles && !isExpanded ? 'text-[12px]' : 'text-sm'}`}>
              {budget.name}
            </h3>

            {!isExpanded && (
              <span
                className={`tracking-wide mt-1 motion-safe:transition-colors motion-safe:duration-[320ms] ${
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
                <span className="text-sm font-bold font-mono mr-2 tracking-tight motion-safe:transition-colors motion-safe:duration-[320ms] text-slate-500">
                  ${total.toFixed(0)}
                  <span className="mx-1.5 opacity-30 font-medium text-slate-400">/</span>
                </span>

                <span className="text-xl font-extrabold font-mono tracking-tighter leading-none motion-safe:transition-colors motion-safe:duration-[320ms] text-slate-600 dark:text-slate-100">
                  ${budget.totalLimit}
                </span>
              </div>

              <span className="text-[11px] font-medium tracking-wide mt-0.5 motion-safe:transition-colors motion-safe:duration-[320ms] text-slate-400 dark:text-slate-500">
                Vault Capacity
              </span>
            </>
          ) : (
            <span
              className={`font-black tracking-tight motion-safe:transition-colors motion-safe:duration-[320ms] text-slate-500 dark:text-slate-100 ${useCompactCollapsedStyles ? 'text-xs' : 'text-sm'}`}
              aria-label={`${budget.totalLimit} dollar budget`}
            >
              ${budget.totalLimit}
            </span>
          )}
        </div>
      </div>

      {/* TRANSACTIONS LIST (Now stays mounted, styled to smoothly collapse) */}
      <div
        className={`min-h-0 overflow-y-auto no-scrollbar relative z-10 budget-content-reveal motion-safe:transition-[opacity] motion-safe:duration-[320ms] motion-safe:ease-[cubic-bezier(0.32,0.72,0.24,1)] transform origin-top ${
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
          // Collapsed lists stay MOUNTED (see the comment above) but must not
          // participate in layout or paint. `content-visibility: hidden` skips
          // both for the entire subtree while keeping the DOM — and therefore
          // React state and scroll position — intact.
          //
          // This matters because every budget's list is in the DOM at all
          // times. Without it, a single expand relayouts and repaints every
          // transaction row of every *other* budget too, on every frame of the
          // 320ms transition. Unmounting instead (`{isExpanded && ...}`) would
          // be cheaper still but makes the collapse animation drop its content
          // on the first frame, which is worse than the jank it fixes.
          //
          // The collapsed branch is already `h-0 opacity-0` with no transition
          // on either, so nothing visible is lost by skipping its paint.
          contentVisibility: isExpanded ? 'visible' : 'hidden',
        }}
        onClick={handleBackgroundClick}
      >
        <div className="pt-1 pb-6 space-y-4">
          <div className="flex items-center justify-between px-2">
            <span className="text-[11px] font-semibold tracking-wide motion-safe:transition-colors motion-safe:duration-[320ms] text-slate-400 dark:text-slate-500">
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

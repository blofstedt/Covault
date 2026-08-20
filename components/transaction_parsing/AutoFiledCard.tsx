import React, { useCallback, useState } from 'react';
import { Transaction, BudgetCategory } from '../../types';
import ParsingCard from '../ui/ParsingCard';
import { getBudgetIcon } from '../dashboard_components/getBudgetIcon';
import { getBudgetColor } from '../../lib/budgetColors';
import { formatCurrency } from '../../lib/formatCurrency';
import { parseLocalDate } from '../../lib/dateUtils';
import CategoryPickerSheet, { type ExistingRule } from './CategoryPickerSheet';
import { hapticTap } from '../../lib/haptics';

// Hoisted for the same reason AIEnteredRow hoists its formatter: a fresh
// Intl.DateTimeFormat per row per render is pure waste on a list that scrolls.
const SHORT_DATE_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

interface AutoFiledCardProps {
  /** Auto-filed captures from the last few days (lib/reviewQueue). */
  transactions: Transaction[];
  budgets: BudgetCategory[];
  /** Move one to another budget. Same handler the review list teaches with. */
  onChangeCategory?: (tx: Transaction, budgetId: string) => Promise<void> | void;
  /** Rules already taught for a vendor, offered first in the picker. */
  existingRulesFor?: (vendor: string) => ExistingRule[];
  /**
   * Clear the receipt. Nothing is deleted — see buildAutoFiledClearPayload.
   *
   * Handed the rows on screen rather than called bare, for the same reason the
   * review card's bulk actions are: a reload can land while the confirmation is
   * open, and the user agreed to clear what they were looking at.
   */
  onClear?: (txs: Transaction[]) => void;
  isExpanded?: boolean;
  onToggleExpanded?: () => void;
}

/**
 * What the app filed without asking.
 *
 * "File known vendors automatically" stores a confidently matched capture
 * already cleared, so it never enters the review list. That is what the
 * setting is for — but it left no trace at all, and the result was a capture
 * page reading "All caught up" while purchases were being recorded. Twice, the
 * same purchase was typed in by hand a minute after being captured, because
 * there was nowhere it could be seen.
 *
 * So this is a receipt, not a queue. Nothing here is waiting on the user and
 * nothing asks to be accepted; each row says where the money went and offers
 * one thing — move it, if a stale rule sent it to the wrong budget. Which is
 * the other half of the problem: the rule that files a purchase silently is
 * the rule nobody is checking.
 */
const AutoFiledCard: React.FC<AutoFiledCardProps> = ({
  transactions,
  budgets,
  onChangeCategory,
  existingRulesFor,
  onClear,
  isExpanded = true,
  onToggleExpanded,
}) => {
  const [movingTx, setMovingTx] = useState<Transaction | null>(null);
  // Rows the user has just moved — dropped from the list after the picker
  // closes so the card doesn't restate a decision they just made, without
  // waiting on the reload.
  const [movedIds, setMovedIds] = useState<Set<string>>(new Set());

  const rows = transactions.filter((tx) => !movedIds.has(tx.id));

  const handlePick = useCallback(
    (budgetId: string) => {
      const tx = movingTx;
      setMovingTx(null);
      if (!tx) return;
      hapticTap();
      setMovedIds((prev) => new Set(prev).add(tx.id));
      void onChangeCategory?.(tx, budgetId);
    },
    [movingTx, onChangeCategory],
  );

  const budgetNameFor = (tx: Transaction): string =>
    budgets.find((b) => b.id === tx.budget_id)?.name || 'Other';

  // Nothing was filed without the user, so there is nothing to account for.
  // Rendering an empty card here would put a permanent "Nothing filed on its
  // own" on the page of everyone who has the setting off — which is everyone,
  // by default. The card appears when it has something to say.
  if (rows.length === 0) return null;

  return (
    <ParsingCard
      id="parsing-auto-filed"
      colorScheme="slate"
      className="shrink-0"
      collapsible
      isExpanded={isExpanded}
      onToggleExpanded={onToggleExpanded}
      icon={<><path d="M20 6L9 17l-5-5" /><path d="M20 12v6a2 2 0 01-2 2H6a2 2 0 01-2-2v-6" /></>}
      title="Filed automatically"
      subtitle="Matched your rules — already in your budgets"
      count={rows.length}
    >
      <div className="space-y-2">
        {rows.map((tx) => {
          const budgetName = budgetNameFor(tx);
          return (
            // Same surface as a review row — glassy card, 2rem radius, left
            // accent bar — but the accent carries the budget's own colour
            // rather than a state, because there is no state to report.
            <div
              key={tx.id}
              className="w-full p-4 rounded-[2rem] border border-l-4 shadow-sm ring-1 ring-inset ring-white/10 dark:ring-white/[0.03] backdrop-blur-xl bg-white/80 dark:bg-slate-900/80 border-slate-200/40 dark:border-slate-700/40"
              style={{ borderLeftColor: getBudgetColor(budgetName) }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start space-x-3 min-w-0 flex-1">
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${getBudgetColor(budgetName)}1f` }}
                  >
                    <span className="w-4 h-4" style={{ color: getBudgetColor(budgetName) }}>
                      {getBudgetIcon(budgetName)}
                    </span>
                  </div>
                  <div className="text-left min-w-0 flex-1">
                    <p className="text-[14px] font-bold text-slate-600 dark:text-slate-100 tracking-tight truncate">
                      {tx.vendor}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1 min-w-0">
                      <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/60 px-2 py-0.5 rounded-full truncate">
                        {budgetName}
                      </span>
                      <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 shrink-0">
                        {SHORT_DATE_FMT.format(parseLocalDate(tx.date))}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <span className="text-lg font-black tracking-tighter text-slate-500 dark:text-slate-50">
                    {formatCurrency(Math.abs(tx.amount))}
                  </span>
                </div>
              </div>

              {onChangeCategory && (
                <button
                  type="button"
                  onClick={() => setMovingTx(tx)}
                  className="w-full mt-3 min-h-[44px] px-4 text-[13px] font-bold rounded-2xl text-slate-500 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-[0.98] transition-all"
                >
                  Move to another budget
                </button>
              )}
            </div>
          );
        })}
      </div>

      {onClear && (
        // Same control as the review card's "Clear all", deliberately: it is
        // the same gesture on the same page and should not look like a
        // different idea. No trash-can twin here, though — these rows are
        // already filed, and offering to delete them from the receipt is not
        // what anybody reading a receipt is trying to do.
        <button
          type="button"
          onClick={() => onClear(rows)}
          className="w-full min-h-[44px] mt-3 text-[11px] font-bold rounded-2xl text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors active:scale-[0.99]"
        >
          Clear all
        </button>
      )}

      {movingTx && (
        <CategoryPickerSheet
          vendor={movingTx.vendor}
          budgets={budgets}
          existingRules={existingRulesFor?.(movingTx.vendor)}
          onClose={() => setMovingTx(null)}
          onPick={handlePick}
        />
      )}
    </ParsingCard>
  );
};

export default AutoFiledCard;

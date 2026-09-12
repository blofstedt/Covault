import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Transaction, BudgetCategory } from '../../types';
import ParsingCard from '../ui/ParsingCard';
import { getBudgetIcon } from '../dashboard_components/getBudgetIcon';
import { getBudgetColor } from '../../lib/budgetColors';
import { formatCurrency } from '../../lib/formatCurrency';
import { parseLocalDate } from '../../lib/dateUtils';
import CategoryPickerSheet, { type ExistingRule } from './CategoryPickerSheet';
import { hapticTap } from '../../lib/haptics';
import { mergeReceiptRows } from '../../lib/autoFiledReceipt';

// Hoisted for the same reason AIEnteredRow hoists its formatter: a fresh
// Intl.DateTimeFormat per row per render is pure waste on a list that scrolls.
const SHORT_DATE_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

/**
 * How long the rows have to be on screen before they count as read.
 *
 * Not zero. A page that marks something seen on the frame it mounts has not
 * shown it to anybody — a user who opens Review and immediately taps through
 * to something else would silently clear a receipt they never looked at, which
 * is the one thing this card exists to prevent.
 */
const DWELL_MS = 1200;

/** How much of the list has to be in view to count. */
const VISIBLE_FRACTION = 0.35;

interface AutoFiledCardProps {
  /** Auto-filed captures from the last few days (lib/reviewQueue). */
  transactions: Transaction[];
  budgets: BudgetCategory[];
  /** Categories the user has turned off — not offered when moving a row. See lib/budgetVisibility.ts. */
  hiddenCategories?: string[];
  /** Move one to another budget. Same handler the review list teaches with. */
  onChangeCategory?: (tx: Transaction, budgetId: string) => Promise<void> | void;
  /** Rules already taught for a vendor, offered first in the picker. */
  existingRulesFor?: (vendor: string) => ExistingRule[];
  /**
   * These rows have now been on screen long enough to count as read.
   *
   * The handler clears their `auto_filed` flag and — this is the important
   * half — does NOT reload the transaction list, so nothing moves or vanishes
   * while the user is still looking at it. They are gone on the next visit.
   */
  onSeen?: (txs: Transaction[]) => void;
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
 * So this is a receipt, not a queue: nothing here is waiting on the user and
 * nothing asks to be accepted. Which is exactly why it used to be wrong. A
 * receipt that can only be put down by tapping "Clear all" is a queue after
 * all — it sat there accumulating, asking to be dealt with, and the only way
 * to deal with it was a button that swept away rows you had read and rows you
 * had not without knowing the difference.
 *
 * It clears itself now. When the list has been on screen, expanded, for
 * `DWELL_MS`, those rows are marked read — but they stay drawn for the rest of
 * the visit, because rows evaporating under a reading eye is its own kind of
 * broken. Come back later and the card holds only what has arrived since. The
 * card disappears entirely when that is nothing, which is most of the time.
 * There is no Clear button anywhere on it, and that is the point: the only
 * thing this card ever wanted was to be looked at.
 *
 * Two consequences worth stating plainly. Being read is recorded on the
 * transaction (`auto_filed: false`) rather than on the phone, so one person
 * reading the receipt puts it down for the whole household — which is the
 * behaviour "Clear all" already had, and deliberately, for the same reason:
 * a vault is shared and a notice one of them has acknowledged should not come
 * back on the other's phone. And if the write fails, nothing is marked and the
 * rows are simply there again next time, which is the right way round.
 *
 * The row is one compact block — no full-width button underneath it — because
 * this card sits directly above "Existing Rules", whose rows are a single
 * line. A receipt with rows twice the height of the rules list reads as though
 * it is asking for more attention than it is. The one thing a row still does
 * is move to another budget, which is the other half of the original problem:
 * the rule that files a purchase silently is the rule nobody is checking.
 */
const AutoFiledCard: React.FC<AutoFiledCardProps> = ({
  transactions,
  budgets,
  hiddenCategories = [],
  onChangeCategory,
  existingRulesFor,
  onSeen,
  isExpanded = true,
  onToggleExpanded,
}) => {
  const [movingTx, setMovingTx] = useState<Transaction | null>(null);
  // Rows the user has just moved — dropped from the list after the picker
  // closes so the card doesn't restate a decision they just made, without
  // waiting on the reload.
  const [movedIds, setMovedIds] = useState<Set<string>>(new Set());

  /**
   * Everything this card has shown during this visit.
   *
   * Held here rather than read straight off the prop, because marking a row
   * read is a write to the row itself and the next reload legitimately stops
   * returning it. See `lib/autoFiledReceipt.ts`, where the rule and its
   * reasons live. This card unmounts when Review is left, so "this visit" and
   * "this mount" are the same thing.
   */
  const shownRef = useRef<Map<string, Transaction>>(new Map());
  const rows = mergeReceiptRows(shownRef.current, transactions, movedIds);

  // ── Marking the rows read ──
  const listRef = useRef<HTMLDivElement>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const onSeenRef = useRef(onSeen);
  onSeenRef.current = onSeen;
  // The ids currently listed, as a stable string, so the effect below re-runs
  // when a NEW capture arrives but not on every unrelated render.
  const rowIdKey = rows.map((tx) => tx.id).join(',');

  useEffect(() => {
    if (!isExpanded || !rowIdKey) return;
    const node = listRef.current;
    if (!node) return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    const markRead = () => {
      const fresh = rows.filter((tx) => !seenIdsRef.current.has(tx.id));
      if (fresh.length === 0) return;
      fresh.forEach((tx) => seenIdsRef.current.add(tx.id));
      onSeenRef.current?.(fresh);
    };

    // No IntersectionObserver (old WebView, a test environment) is not a
    // reason to strand the receipt forever. Fall back to the dwell alone: the
    // card is expanded, which is the part that matters most.
    if (typeof IntersectionObserver === 'undefined') {
      timer = setTimeout(markRead, DWELL_MS);
      return () => { if (timer) clearTimeout(timer); };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const onScreen = entries.some((entry) => entry.isIntersecting);
        if (onScreen) {
          if (!timer) timer = setTimeout(markRead, DWELL_MS);
        } else if (timer) {
          // Scrolled away before the dwell was up: it was not read.
          clearTimeout(timer);
          timer = null;
        }
      },
      { threshold: VISIBLE_FRACTION },
    );
    observer.observe(node);

    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [isExpanded, rowIdKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <div ref={listRef} className="space-y-1.5">
        {rows.map((tx) => {
          const budgetName = budgetNameFor(tx);
          return (
            // The review row's surface, at the receipt's weight: same glassy
            // card and budget-coloured accent bar, but `p-3` and a 1rem radius
            // rather than `p-4` and 2rem, because a 2rem corner on a row this
            // short reads as a lozenge rather than a card.
            <div
              key={tx.id}
              className="w-full p-3 rounded-2xl border border-l-4 shadow-sm ring-1 ring-inset ring-white/10 dark:ring-white/[0.03] backdrop-blur-xl bg-white/80 dark:bg-slate-900/80 border-slate-200/40 dark:border-slate-700/40"
              style={{ borderLeftColor: getBudgetColor(budgetName) }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div
                    className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${getBudgetColor(budgetName)}1f` }}
                  >
                    <span className="w-3.5 h-3.5" style={{ color: getBudgetColor(budgetName) }}>
                      {getBudgetIcon(budgetName)}
                    </span>
                  </div>
                  <div className="text-left min-w-0 flex-1">
                    <p className="text-[13px] font-bold text-slate-600 dark:text-slate-100 tracking-tight truncate">
                      {tx.vendor}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                      <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/60 px-1.5 py-0.5 rounded-full truncate">
                        {budgetName}
                      </span>
                      <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 shrink-0">
                        {SHORT_DATE_FMT.format(parseLocalDate(tx.date))}
                      </span>
                    </div>
                  </div>
                </div>

                {/* The amount, and the one thing a row can do. Beside the
                    figure rather than under it: with a single icon there is
                    room for both on one line, and stacking them was what made
                    this row as tall as the labelled button it replaced. */}
                <div className="shrink-0 flex items-center gap-0.5">
                  <span className="text-[15px] font-black tracking-tighter text-slate-500 dark:text-slate-50">
                    {formatCurrency(Math.abs(tx.amount))}
                  </span>

                  {onChangeCategory && (
                    <button
                      type="button"
                      onClick={() => setMovingTx(tx)}
                      aria-label={`Move ${tx.vendor} to another budget`}
                      title="Move to another budget"
                      className="shrink-0 inline-flex items-center justify-center p-1.5 rounded-lg text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-[0.95] transition-all"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 3l4 4-4 4" />
                        <path d="M21 7H7" />
                        <path d="M7 21l-4-4 4-4" />
                        <path d="M3 17h14" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Where "Clear all" used to be. Nothing to tap — it says what is about
          to happen on its own, because a list that empties itself without
          warning is indistinguishable from one that lost something. */}
      <p className="mt-2.5 text-center text-[10px] font-semibold tracking-wide text-slate-400 dark:text-slate-600">
        Clears itself once you've seen it
      </p>

      {movingTx && (
        <CategoryPickerSheet
          vendor={movingTx.vendor}
          budgets={budgets}
          hiddenCategories={hiddenCategories}
          currentBudgetId={movingTx.budget_id}
          existingRules={existingRulesFor?.(movingTx.vendor)}
          onClose={() => setMovingTx(null)}
          onPick={handlePick}
        />
      )}
    </ParsingCard>
  );
};

export default AutoFiledCard;

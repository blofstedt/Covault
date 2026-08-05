import React, { useMemo, useState, useCallback } from 'react';
import { Transaction, BudgetCategory } from '../../types';
import ParsingCard from '../ui/ParsingCard';
import { EmptyState } from '../shared';
import AIEnteredRow from './AIEnteredRow';
import type { NotATxRuleType } from './NotATransactionModal';
import type { ExistingRule } from './CategoryPickerSheet';
import { useVendorMatcher, selectBulkAcceptable } from '../../lib/hooks/useVendorMatcher';
import type { VendorOverride } from './useVendorOverrides';
import { hapticSuccess } from '../../lib/haptics';
import { detectFuelHoldPlaceholder } from '../../lib/fuelHold';
import { isFuelHoldResolved } from '../../lib/localNotificationMemory';

interface AITransactionsEnteredCardProps {
  aiTransactions: Transaction[];
  budgets: BudgetCategory[];
  onTransactionTap?: (tx: Transaction) => void;
  onClear?: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  /** Captured refunds filtered out upstream, surfaced in the subtitle. */
  refundCount?: number;
  needsReviewIds?: Set<string>;
  onDeleteTransaction?: (id: string) => Promise<void> | void;
  onVendorRenamed?: (tx: Transaction, newVendor: string) => Promise<void> | void;
  onMarkNotTransaction?: (tx: Transaction, ruleType: NotATxRuleType) => Promise<void> | void;
  userId?: string;
  isExpanded?: boolean;
  onToggleExpanded?: () => void;
  vendorOverrides?: VendorOverride[];
  /** Accept the current mapping and file the row. */
  onAccept?: (tx: Transaction) => Promise<void> | void;
  /** File the row under a budget AND remember the pairing as a rule. */
  onChangeCategory?: (tx: Transaction, targetBudgetId: string) => Promise<void> | void;
  /** Rules already taught for a given vendor, offered first in the picker. */
  existingRulesFor?: (vendor: string) => ExistingRule[];
  /** Every rule the user has taught, for the rename typeahead. */
  knownRules?: ExistingRule[];
  /** File several rows at once (the "Accept N known vendors" action). */
  onAcceptMany?: (txs: Transaction[]) => Promise<void> | void;
  /** Replace a fuel-hold placeholder with what the user actually paid. */
  onAmountCorrected?: (tx: Transaction, amount: number) => Promise<void> | void;
  /** Every loaded transaction, for pairing a settled fuel charge with its hold. */
  allTransactions?: Transaction[];
  /** Fold a settled fuel charge into the placeholder row it settles. */
  onSettleFuelHold?: (placeholder: Transaction, charge: Transaction) => Promise<void> | void;
}

// Stable identities for omitted props — a fresh Set/array per render would
// invalidate the memos that depend on them.
const EMPTY_IDS = new Set<string>();
const EMPTY_OVERRIDES: VendorOverride[] = [];

const AITransactionsEnteredCard: React.FC<AITransactionsEnteredCardProps> = ({
  aiTransactions,
  budgets,
  onTransactionTap,
  onClear,
  onRefresh,
  isRefreshing = false,
  refundCount = 0,
  needsReviewIds = EMPTY_IDS,
  onDeleteTransaction,
  onVendorRenamed,
  onMarkNotTransaction,
  userId,
  isExpanded = true,
  onToggleExpanded,
  vendorOverrides = EMPTY_OVERRIDES,
  onAccept,
  onChangeCategory,
  existingRulesFor,
  knownRules,
  onAcceptMany,
  onAmountCorrected,
  allTransactions,
  onSettleFuelHold,
}) => {
  const { classifyAll } = useVendorMatcher(vendorOverrides);
  const matchMap = useMemo(() => classifyAll(aiTransactions), [classifyAll, aiTransactions]);

  // Rows the user just filed — hidden immediately (after their completion
  // animation) so they vanish smoothly without waiting for the DB reload.
  const [filedIds, setFiledIds] = useState<Set<string>>(new Set());
  const handleFiled = useCallback((txId: string) => {
    setFiledIds((prev) => {
      const next = new Set(prev);
      next.add(txId);
      return next;
    });
  }, []);

  // `aiTransactions` already excludes refunds and cleared rows — the caller
  // filters with selectAwaitingReview (lib/reviewQueue.ts), which is what keeps
  // this list and the bottom-bar badge in agreement. All that's left here is
  // hiding rows the user just filed, before the DB reload catches up.
  const nonRefunds = useMemo(
    () => aiTransactions.filter((tx) => !filedIds.has(tx.id)),
    [aiTransactions, filedIds],
  );

  // Rows a single tap can file: rules the user wrote, already pointing at a
  // category. Offered from two upwards — for one row the per-row Accept is
  // right there and a second control would just be noise.
  const budgetIds = useMemo(() => new Set(budgets.map((b) => b.id)), [budgets]);
  // Fuel holds are excluded even when the vendor rule is a perfect match. The
  // one-tap bulk action exists for rows there is nothing left to decide about,
  // and a placeholder amount is precisely a row with something left to decide —
  // filing it in a batch is how a wrong number gets into the budget without
  // anyone reading it.
  const bulkAcceptable = useMemo(
    () =>
      selectBulkAcceptable(
        nonRefunds,
        matchMap,
        (tx) => !!tx.budget_id && budgetIds.has(tx.budget_id),
      ).filter((tx) => isFuelHoldResolved(tx.id) || !detectFuelHoldPlaceholder(tx)),
    [nonRefunds, matchMap, budgetIds],
  );

  const handleAcceptAll = useCallback(() => {
    if (!onAcceptMany || bulkAcceptable.length === 0) return;
    // A notch above the single-row tap: several things just happened at once.
    hapticSuccess();
    setFiledIds((prev) => {
      const next = new Set(prev);
      for (const tx of bulkAcceptable) next.add(tx.id);
      return next;
    });
    void onAcceptMany(bulkAcceptable);
  }, [onAcceptMany, bulkAcceptable]);

  return (
    <ParsingCard
      id="parsing-ai-entered"
      colorScheme="emerald"
      className="shrink-0"
      collapsible
      isExpanded={isExpanded}
      onToggleExpanded={onToggleExpanded}
      icon={<><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>}
      title="To review"
      subtitle={
        nonRefunds.length === 0
          ? 'Nothing waiting'
          : refundCount > 0
            ? `${refundCount} refund${refundCount === 1 ? '' : 's'} hidden`
            : 'From your bank alerts'
      }
      count={nonRefunds.length}
      onScan={onRefresh}
      isScanning={isRefreshing}
      scanLabel="Scan for new transactions"
    >
      {isExpanded && (
        <div className="space-y-3">
          {onAcceptMany && bulkAcceptable.length > 1 && (
            <button
              type="button"
              onClick={handleAcceptAll}
              className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-900/20 text-[13px] font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 active:scale-[0.99] transition-all"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Accept {bulkAcceptable.length} known {bulkAcceptable.length === 1 ? 'vendor' : 'vendors'}
            </button>
          )}
          {nonRefunds.length === 0 ? (
            <EmptyState
              icon={<svg className="w-8 h-8 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
              message="All caught up"
              description="New transactions from your bank alerts will show up here."
            />
          ) : (
            nonRefunds.map((tx) => {
              const matched = matchMap.get(tx.id);
              return (
                <AIEnteredRow
                  key={tx.id}
                  tx={tx}
                  budgets={budgets}
                  isForReview={needsReviewIds.has(tx.id)}
                  onTransactionTap={onTransactionTap}
                  onDeleteTransaction={onDeleteTransaction}
                  onVendorRenamed={onVendorRenamed}
                  onMarkNotTransaction={onMarkNotTransaction}
                  userId={userId}
                  matchResult={matched}
                  onAccept={onAccept}
                  onChangeCategory={onChangeCategory}
                  existingRules={existingRulesFor?.(tx.vendor)}
                  knownRules={knownRules}
                  onFiled={handleFiled}
                  onAmountCorrected={onAmountCorrected}
                  allTransactions={allTransactions}
                  onSettleFuelHold={onSettleFuelHold}
                />
              );
            })
          )}
          {onClear && nonRefunds.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="w-full min-h-[44px] mt-1 text-[11px] font-bold rounded-2xl text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors active:scale-[0.99]"
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </ParsingCard>
  );
};

export default AITransactionsEnteredCard;
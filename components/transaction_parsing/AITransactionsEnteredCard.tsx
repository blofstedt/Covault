import React, { useState, useCallback } from 'react';
import { Transaction, BudgetCategory } from '../../types';
import ParsingCard from '../ui/ParsingCard';
import { EmptyState } from '../shared';
import { getBudgetIcon } from '../dashboard_components/getBudgetIcon';
import { parseLocalDate } from '../../lib/dateUtils';
import { isSoftDupDismissed, markSoftDupDismissed } from '../../lib/localNotificationMemory';
import { isRefund } from '../../lib/refundMatching';
import SoftDuplicateBadge from './SoftDuplicateBadge';

interface AITransactionsEnteredCardProps {
  /** AI-entered transactions (label === 'AI') */
  aiTransactions: Transaction[];
  budgets: BudgetCategory[];
  onTransactionTap?: (tx: Transaction) => void;
  onClear?: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  needsReviewIds?: Set<string>;
  /** Delete a transaction by ID. Used by the soft-dup badge to remove the older one. */
  onDeleteTransaction?: (id: string) => void;
}

const AITransactionsEnteredCard: React.FC<AITransactionsEnteredCardProps> = ({
  aiTransactions,
  budgets,
  onTransactionTap,
  onClear,
  onRefresh,
  isRefreshing = false,
  needsReviewIds = new Set(),
  onDeleteTransaction,
}) => {
  const budgetNameById = new Map<string, string>(budgets.map(b => [b.id, b.name]));

  // Track which transactions the user is currently deleting (per-id loading
  // state for the soft-dup popover's delete button). This keeps the rest
  // of the list interactive while one deletion is in flight.
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Local set of dismissed pairs (in addition to localStorage). The
  // localStorage check survives reloads; this set is just here to force
  // a re-render immediately after the user dismisses, so the badge
  // disappears without waiting for the parent to re-fetch.
  const [localDismissed, setLocalDismissed] = useState<Set<string>>(() => new Set());

  const handleDismissSoftDup = useCallback((currentTxId: string, similarTxId: string) => {
    markSoftDupDismissed(currentTxId, similarTxId);
    setLocalDismissed(prev => {
      const next = new Set(prev);
      next.add(`${currentTxId}|${similarTxId}`);
      return next;
    });
  }, []);

  const handleDeleteSimilar = useCallback(async (similarTxId: string) => {
    if (!onDeleteTransaction) return;
    setDeletingId(similarTxId);
    try {
      await onDeleteTransaction(similarTxId);
    } finally {
      setDeletingId(null);
    }
  }, [onDeleteTransaction]);

  return (
    <ParsingCard
      id="parsing-ai-entered"
      colorScheme="emerald"
      className="flex-1 min-h-0 flex flex-col overflow-hidden"
      icon={<><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>}
      title="Caught Transactions"
      subtitle="AI-processed transactions added to your budgets"
      count={aiTransactions.length}
      headerAction={<div className="flex items-center gap-1"><button onClick={onRefresh} disabled={isRefreshing} className="p-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors" title="Scan for new transactions" aria-label="Scan for new transactions"><svg className={`w-4 h-4 text-emerald-500 dark:text-emerald-400 ${isRefreshing ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" /></svg></button><button onClick={onClear} className="p-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors" title="Clear entered" aria-label="Clear all entered transactions"><svg className="w-4 h-4 text-slate-400 dark:text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg></button></div>}
    >
      {aiTransactions.length > 0 ? (
        <div
          className="flex-1 min-h-0 overflow-y-auto no-scrollbar space-y-2 pr-1 pb-2"
          style={{
            WebkitOverflowScrolling: 'touch',
            overscrollBehavior: 'contain',
            overscrollBehaviorY: 'contain',
            overflowAnchor: 'none',
            touchAction: 'pan-y',
          }}
        >
          {aiTransactions.filter((tx) => !isRefund(tx)).map((tx) => {
            const budgetName = tx.budget_id ? (budgetNameById.get(tx.budget_id) || null) : null;
            const isForReview = needsReviewIds.has(tx.id);
            // Show the badge only if the user hasn't previously dismissed
            // this exact pair. Dismissals are persisted in localStorage
            // and also tracked in local state for instant UI updates.
            const softDup = tx.softDuplicateOf
              && !isSoftDupDismissed(tx.id, tx.softDuplicateOf.id)
              && !localDismissed.has(`${tx.id}|${tx.softDuplicateOf.id}`)
              ? tx.softDuplicateOf
              : null;

            return (
              <button
                key={tx.id}
                onClick={() => onTransactionTap?.(tx)}
                className={`w-full flex items-center justify-between p-4 rounded-2xl border ring-1 ring-inset ring-white/10 dark:ring-white/[0.04] transition-all duration-200 active:scale-[0.98] cursor-pointer text-left hover:shadow-md ${
                  softDup
                    ? 'bg-amber-50/70 dark:bg-amber-900/15 border-amber-200 dark:border-amber-700/40'
                    : isForReview
                    ? 'bg-amber-50/70 dark:bg-amber-900/15 border-amber-200 dark:border-amber-700/40'
                    : 'bg-white/60 dark:bg-emerald-900/10 backdrop-blur-sm border-emerald-100 dark:border-emerald-800/30'
                }`}
              >
                <div className="flex items-center space-x-3 min-w-0 flex-1">
                  <div className="w-9 h-9 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl flex items-center justify-center shrink-0">
                    {budgetName ? <span className="text-emerald-600 dark:text-emerald-400 w-4 h-4">{getBudgetIcon(budgetName)}</span> : <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="20 6 9 17 4 12" /></svg>}
                  </div>
                  <div className="text-left min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">{tx.vendor}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      {softDup && (
                        <SoftDuplicateBadge
                          tx={tx}
                          similar={softDup}
                          onDismiss={handleDismissSoftDup}
                          onDeleteSimilar={handleDeleteSimilar}
                          onViewSimilar={(similarId) => {
                            const similar = aiTransactions.find(t => t.id === similarId)
                              || tx.softDuplicateOf && similarId === tx.softDuplicateOf.id ? tx : null;
                            // The similar tx is usually NOT in the auto-entered
                            // list (it's an older one); the best we can do is
                            // surface its details. Tapping the popover's
                            // "View" link just closes the popover — users can
                            // tap the transaction card to open the modal.
                            // (We keep the button in the popover for symmetry.)
                          }}
                          isDeleting={deletingId === softDup.id}
                        />
                      )}
                      {isForReview && <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 tracking-wide">For Review</span>}
                      {budgetName && <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 tracking-wide">{budgetName}</span>}
                      <span className="text-[10px] text-slate-400 dark:text-slate-500">{parseLocalDate(tx.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                    </div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className={`text-sm font-extrabold font-mono ${tx.amount < 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-200'}`}>{tx.amount < 0 ? '+' : ''}${Math.abs(tx.amount).toFixed(2)}</span>
                  <p className="text-[10px] font-semibold tracking-wide text-emerald-600 dark:text-emerald-400 mt-0.5">{tx.amount < 0 ? (tx.is_income ? 'Income' : 'Refund') : 'AI'}</p>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <EmptyState
            icon={<svg className="w-6 h-6 text-slate-300 dark:text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>}
            message="No AI transactions yet"
            description="Transactions will appear here as Covault AI processes your bank notifications."
            size="md"
          />
        </div>
      )}
    </ParsingCard>
  );
};

export default AITransactionsEnteredCard;

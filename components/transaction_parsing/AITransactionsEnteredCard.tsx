import React, { useState, useCallback } from 'react';
import { Transaction, BudgetCategory } from '../../types';
import ParsingCard from '../ui/ParsingCard';
import { EmptyState } from '../shared';
import { isRefund } from '../../lib/refundMatching';
import AIEnteredRow from './AIEnteredRow';
import type { NotATxRuleType } from './NotATransactionModal';

interface AITransactionsEnteredCardProps {
  /** AI-entered transactions (label === 'AI') */
  aiTransactions: Transaction[];
  budgets: BudgetCategory[];
  onTransactionTap?: (tx: Transaction) => void;
  onClear?: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  needsReviewIds?: Set<string>;
  /** Delete a transaction by ID. Used by the soft-dup popover and the
   *  "not a transaction" flow. */
  onDeleteTransaction?: (id: string) => Promise<void> | void;
  /** Persist a vendor rename. The handler should also write the
   *  correction to the overrides table so future notifications from
   *  the same vendor use the new name. */
  onVendorRenamed?: (tx: Transaction, newVendor: string) => Promise<void> | void;
  /** Create a "not a transaction" skip rule and delete the row. */
  onMarkNotTransaction?: (tx: Transaction, ruleType: NotATxRuleType) => Promise<void> | void;
  /** User id, used for the backfill count/apply. */
  userId?: string;
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
  onVendorRenamed,
  onMarkNotTransaction,
  userId,
}) => {
  return (
    <ParsingCard
      id="parsing-ai-entered"
      colorScheme="emerald"
      className="flex-1 min-h-0 flex flex-col overflow-hidden"
      icon={<><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>}
      title="Caught Transactions"
      subtitle="AI-processed transactions added to your budgets"
      count={aiTransactions.length}
      headerAction={
        <div className="flex items-center gap-1">
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="p-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
            title="Scan for new transactions"
            aria-label="Scan for new transactions"
          >
            <svg
              className={`w-4 h-4 text-emerald-500 dark:text-emerald-400 ${isRefreshing ? 'animate-spin' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
          </button>
          <button
            onClick={onClear}
            className="p-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
            title="Clear entered"
            aria-label="Clear all entered transactions"
          >
            <svg
              className="w-4 h-4 text-slate-400 dark:text-slate-500"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>
        </div>
      }
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
          {aiTransactions
            .filter((tx) => !isRefund(tx))
            .map((tx) => (
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
              />
            ))}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <EmptyState
            icon={
              <svg className="w-6 h-6 text-slate-300 dark:text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            }
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

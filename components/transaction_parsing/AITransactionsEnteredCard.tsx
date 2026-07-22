import React, { useMemo } from 'react';
import { Transaction, BudgetCategory } from '../../types';
import ParsingCard from '../ui/ParsingCard';
import { EmptyState } from '../shared';
import { isRefund } from '../../lib/refundMatching';
import AIEnteredRow from './AIEnteredRow';
import type { NotATxRuleType } from './NotATransactionModal';
import { useVendorMatcher } from '../../lib/hooks/useVendorMatcher';
import type { VendorOverride } from './useVendorOverrides';

interface AITransactionsEnteredCardProps {
  aiTransactions: Transaction[];
  budgets: BudgetCategory[];
  onTransactionTap?: (tx: Transaction) => void;
  onClear?: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  needsReviewIds?: Set<string>;
  onDeleteTransaction?: (id: string) => Promise<void> | void;
  onVendorRenamed?: (tx: Transaction, newVendor: string) => Promise<void> | void;
  onMarkNotTransaction?: (tx: Transaction, ruleType: NotATxRuleType) => Promise<void> | void;
  userId?: string;
  isExpanded?: boolean;
  onToggleExpanded?: () => void;
  vendorOverrides?: VendorOverride[];
  onConfirmMatch?: (tx: Transaction, match: any) => void;
  onChangeCategory?: (tx: Transaction, targetBudgetId?: string) => void;
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
  isExpanded = true,
  onToggleExpanded,
  vendorOverrides = [],
  onConfirmMatch,
  onChangeCategory,
}) => {
  const { classifyAll } = useVendorMatcher(vendorOverrides);
  const matchMap = useMemo(() => classifyAll(aiTransactions), [classifyAll, aiTransactions]);

  const nonRefunds = aiTransactions.filter((tx) => !isRefund(tx));
  const refundCount = aiTransactions.length - nonRefunds.length;

  return (
    <ParsingCard
      id="parsing-ai-entered"
      colorScheme="emerald"
      className="shrink-0"
      collapsible
      isExpanded={isExpanded}
      onToggleExpanded={onToggleExpanded}
      icon={<><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>}
      title="Caught Transactions"
      subtitle={`${nonRefunds.length} AI-captured${refundCount > 0 ? ` (${refundCount} refund${refundCount === 1 ? '' : 's'} hidden)` : ''}`}
      count={nonRefunds.length}
      onClear={onClear}
      onRefresh={onRefresh}
      isRefreshing={isRefreshing}
    >
      {isExpanded && (
        <div className="space-y-3">
          {nonRefunds.length === 0 ? (
            <EmptyState
              icon={<svg className="w-8 h-8 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
              title="All caught up"
              description="No AI transactions pending review."
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
                  matchResult={matched?.match}
                  matchState={matched?.state}
                  onConfirmMatch={onConfirmMatch}
                  onChangeCategory={onChangeCategory}
                />
              );
            })
          )}
        </div>
      )}
    </ParsingCard>
  );
};

export default AITransactionsEnteredCard;
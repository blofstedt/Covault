import React from 'react';
import { Transaction } from '../../types';
import { parseLocalDate } from '../../lib/dateUtils';
import type { VendorOverride } from './useVendorOverrides';
import { toVendorKey } from '../../lib/deviceTransactionParser';
import ParsingCard from '../ui/ParsingCard';
import { EmptyState } from '../shared';

interface ApprovedTransactionsCardProps {
  approvedTransactions: Transaction[];
  vendorOverrideByName: Map<string, VendorOverride>;
  onTransactionTap?: (tx: Transaction) => void;
  onClear?: () => void;
}

const ApprovedTransactionsCard: React.FC<ApprovedTransactionsCardProps> = ({
  approvedTransactions,
  vendorOverrideByName,
  onTransactionTap,
  onClear,
}) => (
  <ParsingCard
    id="parsing-approved-section"
    colorScheme="emerald"
    icon={<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></>}
    title="Approved Transactions"
    subtitle="Auto-detected and approved from bank notifications"
    headerAction={approvedTransactions.length > 0 && onClear && (
      <button
        onClick={onClear}
        className="p-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-500 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-all duration-200 active:scale-[0.97]"
        title="Clear all approved transactions"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6" />
        </svg>
      </button>
    )}
  >
    {approvedTransactions.length > 0 ? (
      <div className="space-y-2">
        {approvedTransactions.map((tx) => {
          const vo = vendorOverrideByName.get(toVendorKey(tx.vendor));

          return (
          <button
            key={tx.id}
            onClick={() => onTransactionTap?.(tx)}
            className="w-full flex items-center justify-between p-4 bg-white/60 dark:bg-slate-800/40 backdrop-blur-sm rounded-2xl border border-slate-100 dark:border-slate-800/60 ring-1 ring-inset ring-white/10 dark:ring-white/[0.04] transition-all duration-200 active:scale-[0.98] hover:shadow-md"
          >
            <div className="flex items-center space-x-3">
              <div className="w-9 h-9 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl flex items-center justify-center">
                <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div className="text-left">
                <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate max-w-[160px]">
                  {vo?.proper_name || tx.vendor}
                </p>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                  {parseLocalDate(tx.date).toLocaleDateString()}
                </p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-sm font-extrabold font-mono text-slate-700 dark:text-slate-200">
                ${tx.amount.toFixed(2)}
              </span>
            </div>
          </button>
          );
        })}
      </div>
    ) : (
      <EmptyState
        icon={
          <svg className="w-6 h-6 text-slate-300 dark:text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
        }
        message="No transactions captured yet"
        description="When your banking apps send notifications, they'll appear here for review."
        size="md"
      />
    )}
  </ParsingCard>
);

export default ApprovedTransactionsCard;

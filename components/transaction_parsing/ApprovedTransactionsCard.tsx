import React from 'react';
import { Transaction } from '../../types';
import { parseLocalDate } from '../../lib/dateUtils';
import type { VendorOverride } from './useVendorOverrides';

interface ApprovedTransactionsCardProps {
  approvedTransactions: Transaction[];
  vendorOverrideByName: Map<string, VendorOverride>;
  showDemoData: boolean;
  onTransactionTap?: (tx: Transaction) => void;
}

const ApprovedTransactionsCard: React.FC<ApprovedTransactionsCardProps> = ({
  approvedTransactions,
  vendorOverrideByName,
  showDemoData,
  onTransactionTap,
}) => (
  <div id="parsing-approved-section" className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-xl border border-slate-100 dark:border-slate-800/60 space-y-4">
    <div className="flex items-center space-x-3">
      <div className="p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl">
        <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      </div>
      <div className="flex-1">
        <h3 className="text-xs font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
          Approved Transactions
        </h3>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
          Auto-detected and approved from bank notifications
        </p>
      </div>

    </div>

    {(approvedTransactions.length > 0 || showDemoData) ? (
      <div className="space-y-2">
        {approvedTransactions.map((tx) => {
          const vo = vendorOverrideByName.get(tx.vendor.toLowerCase());
          const approvalLabel = vo?.auto_accept
            ? '- approved automatically'
            : '- approved manually';

          return (
          <button
            key={tx.id}
            onClick={() => onTransactionTap?.(tx)}
            className="w-full flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800/60 transition-all active:scale-[0.98]"
          >
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center">
                <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div className="text-left">
                <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate max-w-[160px]">
                  {vo?.proper_name || tx.vendor}
                </p>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                  {parseLocalDate(tx.date).toLocaleDateString()} {approvalLabel}
                </p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-sm font-black text-slate-700 dark:text-slate-200">
                ${tx.amount.toFixed(2)}
              </span>
            </div>
          </button>
          );
        })}
        {approvedTransactions.length === 0 && showDemoData && (
          <div className="w-full flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800/60">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center">
                <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div className="text-left">
                <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate max-w-[160px]">
                  Coffee Shop
                </p>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                  Jan 15, 2026 - approved manually
                </p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-sm font-black text-slate-700 dark:text-slate-200">
                $5.75
              </span>
            </div>
          </div>
        )}
      </div>
    ) : (
      <div className="py-8 text-center">
        <div className="w-12 h-12 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-3">
          <svg className="w-6 h-6 text-slate-300 dark:text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
        </div>
        <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
          No transactions captured yet
        </p>
        <p className="text-[11px] text-slate-400 dark:text-slate-600 mt-1 leading-relaxed max-w-xs mx-auto">
          When your banking apps send notifications, they'll appear here for review.
        </p>
      </div>
    )}
  </div>
);

export default ApprovedTransactionsCard;

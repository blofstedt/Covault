import React from 'react';
import { PendingTransaction } from '../../types';

interface RejectedTransactionsCardProps {
  rejectedTransactions: PendingTransaction[];
}

const RejectedTransactionsCard: React.FC<RejectedTransactionsCardProps> = ({
  rejectedTransactions,
}) => {
  if (rejectedTransactions.length === 0) return null;

  return (
    <div id="parsing-rejected-section" className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-xl border border-slate-100 dark:border-slate-800/60 space-y-4">
      <div className="flex items-center space-x-3">
        <div className="p-2 bg-red-50 dark:bg-red-900/20 rounded-xl">
          <svg className="w-5 h-5 text-red-600 dark:text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        </div>
        <div className="flex-1">
          <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            Rejected Transactions
          </h3>
          <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
            Blocked due to duplicate detection
          </p>
        </div>
        <span className="text-[10px] font-black bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-2.5 py-1 rounded-full">
          {rejectedTransactions.length}
        </span>
      </div>

      <div className="space-y-2">
        {rejectedTransactions.map((pt) => (
          <div key={pt.id} className="w-full flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800/60">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                <svg className="w-4 h-4 text-red-600 dark:text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </div>
              <div className="text-left min-w-0">
                <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate max-w-[160px]">
                  {pt.extracted_vendor}
                </p>
                <p className="text-[9px] text-red-500 dark:text-red-400 mt-0.5 leading-snug max-w-[200px]">
                  {pt.rejection_reason}
                </p>
              </div>
            </div>
            <div className="text-right shrink-0">
              <span className="text-sm font-black text-slate-700 dark:text-slate-200">
                ${pt.extracted_amount.toFixed(2)}
              </span>
              <p className="text-[8px] font-bold uppercase tracking-wider text-red-500 dark:text-red-400 mt-0.5">
                Rejected
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default RejectedTransactionsCard;

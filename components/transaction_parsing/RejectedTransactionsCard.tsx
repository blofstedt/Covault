import React from 'react';
import { PendingTransaction } from '../../types';
import ParsingCard from '../ui/ParsingCard';
import { EmptyState } from '../shared';

interface RejectedTransactionsCardProps {
  rejectedTransactions: PendingTransaction[];
}

const RejectedTransactionsCard: React.FC<RejectedTransactionsCardProps> = ({
  rejectedTransactions,
}) => {
  return (
    <ParsingCard
      id="parsing-rejected-section"
      colorScheme="red"
      icon={<><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></>}
      title="Rejected Transactions"
      subtitle="Blocked due to duplicate detection"
      count={rejectedTransactions.length}
    >
      {rejectedTransactions.length > 0 ? (
        <div className="space-y-2">
          {rejectedTransactions.map((pt) => (
            <div key={pt.id} className="w-full flex items-center justify-between p-4 bg-white/60 dark:bg-slate-800/40 backdrop-blur-sm rounded-2xl border border-slate-100 dark:border-slate-800/60 ring-1 ring-inset ring-white/10 dark:ring-white/[0.04]">
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 bg-red-100 dark:bg-red-900/30 rounded-xl flex items-center justify-center">
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
                <span className="text-sm font-extrabold font-mono text-slate-700 dark:text-slate-200">
                  ${pt.extracted_amount.toFixed(2)}
                </span>
                <p className="text-[8px] font-semibold tracking-wide text-red-500 dark:text-red-400 mt-0.5">
                  Rejected
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={
            <svg className="w-6 h-6 text-slate-300 dark:text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          }
          message="No rejected transactions"
          description="Transactions blocked by duplicate detection will appear here."
          size="md"
        />
      )}
    </ParsingCard>
  );
};

export default RejectedTransactionsCard;

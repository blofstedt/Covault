import React from 'react';
import ParsingCard from '../ui/ParsingCard';
import { EmptyState } from '../shared';

export interface AIRejectedTransaction {
  id: string;
  vendor?: string;
  amount?: number;
  reason: string;
  bankName?: string;
  timestamp: string;
}

interface AITransactionsRejectedCardProps {
  /** Rejected notifications (duplicates or non-transactions) */
  rejectedTransactions: AIRejectedTransaction[];
  showDemoData?: boolean;
  onClear?: () => void;
}

/**
 * Shows notifications that were rejected by the AI pipeline.
 * Includes duplicates and non-transaction notifications with the reason.
 */
const AITransactionsRejectedCard: React.FC<AITransactionsRejectedCardProps> = ({
  rejectedTransactions,
  showDemoData = false,
  onClear,
}) => {
  return (
    <ParsingCard
      id="parsing-ai-rejected"
      colorScheme="slate"
      icon={
        <>
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </>
      }
      title="Transactions Rejected"
      subtitle="Notifications filtered out by AI"
      count={showDemoData && rejectedTransactions.length === 0 ? 2 : rejectedTransactions.length}
      headerAction={
        <button
          onClick={onClear}
          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title="Clear rejected"
        >
          <svg className="w-4 h-4 text-slate-400 dark:text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          </svg>
        </button>
      }
    >
      {rejectedTransactions.length > 0 ? (
        <div className="space-y-2">
          {rejectedTransactions.map((item) => (
            <div key={item.id} className="w-full flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800/60">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-slate-100 dark:bg-slate-800/50 rounded-full flex items-center justify-center">
                  <svg className="w-4 h-4 text-slate-400 dark:text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </div>
                <div className="text-left min-w-0">
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate max-w-[160px]">
                    {item.vendor || 'Unknown'}
                  </p>
                  <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5 leading-snug max-w-[200px]">
                    {item.reason}
                  </p>
                </div>
              </div>
              <div className="text-right shrink-0">
                {item.amount != null && (
                  <span className="text-sm font-black text-slate-700 dark:text-slate-200">
                    ${item.amount.toFixed(2)}
                  </span>
                )}
                <p className="text-[8px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mt-0.5">
                  Rejected
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : showDemoData ? (
        <div className="space-y-2">
          {[
            { vendor: 'TD Bank', reason: 'Not a transaction — balance alert', amount: null },
            { vendor: 'Amazon', reason: 'Duplicate: Amazon for $29.99 already recorded today', amount: 29.99 },
          ].map((demo, i) => (
            <div key={i} className="w-full flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800/60">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-slate-100 dark:bg-slate-800/50 rounded-full flex items-center justify-center">
                  <svg className="w-4 h-4 text-slate-400 dark:text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </div>
                <div className="text-left min-w-0">
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{demo.vendor}</p>
                  <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">{demo.reason}</p>
                </div>
              </div>
              <div className="text-right shrink-0">
                {demo.amount != null && (
                  <span className="text-sm font-black text-slate-700 dark:text-slate-200">${demo.amount.toFixed(2)}</span>
                )}
                <p className="text-[8px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mt-0.5">Rejected</p>
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
          message="No rejected notifications"
          description="Duplicates and non-transaction notifications will appear here."
          size="md"
        />
      )}
    </ParsingCard>
  );
};

export default AITransactionsRejectedCard;

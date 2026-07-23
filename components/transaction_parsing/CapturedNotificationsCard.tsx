import React from 'react';
import { PendingTransaction } from '../../types';
import ParsingCard from '../ui/ParsingCard';

interface CapturedNotificationsCardProps {
  capturedByBank: Map<string, PendingTransaction[]>;
  capturedCount: number;
  onSetupNotification: (pt: PendingTransaction) => void;
}

const CapturedNotificationsCard: React.FC<CapturedNotificationsCardProps> = ({
  capturedByBank,
  capturedCount,
  onSetupNotification,
}) => {
  if (capturedCount === 0) return null;

  return (
    <ParsingCard
      colorScheme="blue"
      icon={<path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />}
      title="Captured Notifications"
      subtitle="Tap a notification to teach Covault how to read it"
      count={capturedCount}
    >
      {Array.from(capturedByBank.entries()).map(([bankName, notifications]) => (
        <div key={bankName} className="space-y-2">
          <p className="text-[11px] font-semibold tracking-wide text-slate-400 dark:text-slate-500 px-1">
            {bankName}
          </p>

          {notifications.map((pt) => (
            <button
              key={pt.id}
              onClick={() => onSetupNotification(pt)}
              className="w-full flex items-center justify-between p-4 bg-white/60 dark:bg-slate-800/40 backdrop-blur-sm rounded-2xl border border-blue-100 dark:border-blue-800/30 ring-1 ring-inset ring-white/10 dark:ring-white/[0.04] transition-all duration-200 active:scale-[0.98] hover:shadow-md"
            >
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </div>
                <div className="text-left min-w-0">
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-2">
                    {pt.extracted_vendor} — ${pt.extracted_amount}
                  </p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                    {new Date(pt.posted_at).toLocaleString()}
                  </p>
                </div>
              </div>
              <div className="shrink-0 ml-2">
                <span className="text-[11px] font-semibold tracking-wide text-blue-500 dark:text-blue-400">
                  Set up
                </span>
              </div>
            </button>
          ))}
        </div>
      ))}
    </ParsingCard>
  );
};

export default CapturedNotificationsCard;

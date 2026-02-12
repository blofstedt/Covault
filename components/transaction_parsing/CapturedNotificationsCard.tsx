import React from 'react';
import { PendingTransaction } from '../../types';

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
    <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-xl border border-blue-200 dark:border-blue-800/40 space-y-4">
      <div className="flex items-center space-x-3">
        <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-xl">
          <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
        </div>
        <div className="flex-1">
          <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            Captured Notifications
          </h3>
          <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
            Tap a notification to teach Covault how to read it
          </p>
        </div>
        <span className="text-[10px] font-black bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2.5 py-1 rounded-full">
          {capturedCount}
        </span>
      </div>

      {Array.from(capturedByBank.entries()).map(([bankName, notifications]) => (
        <div key={bankName} className="space-y-2">
          <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-1">
            {bankName}
            {!notifications[0]?.pattern_id && (
              <span className="ml-2 text-blue-500 dark:text-blue-400">
                — needs setup
              </span>
            )}
          </p>

          {notifications.map((pt) => (
            <button
              key={pt.id}
              onClick={() => onSetupNotification(pt)}
              className="w-full flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-blue-100 dark:border-blue-800/30 transition-all active:scale-[0.98]"
            >
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </div>
                <div className="text-left min-w-0">
                  <p className="text-[10px] text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-2">
                    {pt.notification_text}
                  </p>
                  <p className="text-[8px] text-slate-400 dark:text-slate-500 mt-0.5">
                    {new Date(pt.posted_at).toLocaleString()}
                  </p>
                </div>
              </div>
              <div className="shrink-0 ml-2">
                <span className="text-[8px] font-black uppercase tracking-wider text-blue-500 dark:text-blue-400">
                  Set up
                </span>
              </div>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
};

export default CapturedNotificationsCard;

import React from 'react';
import { PendingTransaction } from '../../types';

interface IgnoredNotificationsCardProps {
  keywordIgnoredNotifications: PendingTransaction[];
}

const IgnoredNotificationsCard: React.FC<IgnoredNotificationsCardProps> = ({
  keywordIgnoredNotifications,
}) => {
  if (keywordIgnoredNotifications.length === 0) return null;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-xl border border-slate-300 dark:border-slate-700/40 space-y-3">
      <div className="flex items-center space-x-3">
        <div className="p-2 bg-slate-100 dark:bg-slate-800/50 rounded-xl">
          <svg className="w-5 h-5 text-slate-400 dark:text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
        </div>
        <div className="flex-1">
          <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            Ignored Notifications
          </h3>
          <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
            Filtered out by keyword rules
          </p>
        </div>
        <span className="text-[10px] font-black bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-2.5 py-1 rounded-full">
          {keywordIgnoredNotifications.length}
        </span>
      </div>

      <div className="space-y-2">
        {keywordIgnoredNotifications.map((pt) => (
          <div
            key={pt.id}
            className="w-full flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700/30"
          >
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-slate-200 dark:bg-slate-700 rounded-full flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 text-slate-400 dark:text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                </svg>
              </div>
              <div className="text-left min-w-0">
                <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-2">
                  {pt.notification_text}
                </p>
                <p className="text-[8px] text-slate-400 dark:text-slate-500 mt-0.5">
                  {pt.app_name} · {new Date(pt.posted_at).toLocaleString()}
                </p>
              </div>
            </div>
            <span className="text-[8px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 shrink-0 ml-2">
              Ignored
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default IgnoredNotificationsCard;

import React from 'react';
import { PendingTransaction } from '../../types';
import { KEYWORD_IGNORED_PATTERN_ID } from '../../lib/notificationProcessor';
import ParsingCard from '../ui/ParsingCard';

interface IgnoredNotificationsCardProps {
  filteredOutNotifications: PendingTransaction[];
}

/** Derive the reason label for a filtered-out notification. */
function getFilterReason(pt: PendingTransaction): string {
  if (pt.pattern_id === KEYWORD_IGNORED_PATTERN_ID) return 'Keyword filter';
  if (pt.rejection_reason) return 'Duplicate';
  return 'Filtered';
}

const IgnoredNotificationsCard: React.FC<IgnoredNotificationsCardProps> = ({
  filteredOutNotifications,
}) => {
  if (filteredOutNotifications.length === 0) return null;

  return (
    <ParsingCard
      colorScheme="slate"
      icon={<><circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /></>}
      title="Filtered Notifications"
      subtitle="Filtered out by keywords or duplicates"
      count={filteredOutNotifications.length}
    >
      <div className="space-y-2">
        {filteredOutNotifications.map((pt) => (
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
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-2">
                  {pt.notification_text}
                </p>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                  {pt.app_name} · {new Date(pt.posted_at).toLocaleString()}
                </p>
              </div>
            </div>
            <span className="text-[11px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 shrink-0 ml-2">
              {getFilterReason(pt)}
            </span>
          </div>
        ))}
      </div>
    </ParsingCard>
  );
};

export default IgnoredNotificationsCard;

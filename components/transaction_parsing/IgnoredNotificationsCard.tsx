import React from 'react';
import { PendingTransaction } from '../../types';
import ParsingCard from '../ui/ParsingCard';
import { EmptyState } from '../shared';

interface IgnoredNotificationsCardProps {
  filteredOutNotifications: PendingTransaction[];
  onClear?: () => void;
}

/** Derive the reason label for a filtered-out notification. */
function getFilterReason(pt: PendingTransaction): string {
  if (pt.rejection_reason) return pt.rejection_reason;
  return 'Filtered';
}

const IgnoredNotificationsCard: React.FC<IgnoredNotificationsCardProps> = ({
  filteredOutNotifications,
  onClear,
}) => (
  <ParsingCard
    colorScheme="slate"
    icon={<><circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /></>}
    title="Filtered Notifications"
    subtitle="Filtered out by keywords or duplicates"
    count={filteredOutNotifications.length}
    headerAction={filteredOutNotifications.length > 0 && onClear && (
      <button
        onClick={onClear}
        className="p-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all active:scale-95"
        title="Clear all filtered notifications"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6" />
        </svg>
      </button>
    )}
  >
    {filteredOutNotifications.length > 0 ? (
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
                  {pt.extracted_vendor} — ${pt.extracted_amount}
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
    ) : (
      <EmptyState
        icon={
          <svg className="w-6 h-6 text-slate-300 dark:text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
        }
        message="No filtered notifications"
        description="Notifications filtered by keywords or duplicates will appear here."
        size="md"
      />
    )}
  </ParsingCard>
);

export default IgnoredNotificationsCard;

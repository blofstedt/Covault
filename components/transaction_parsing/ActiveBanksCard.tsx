import React from 'react';
import ParsingCard from '../ui/ParsingCard';
import { EmptyState } from '../shared';

interface ActiveBanksCardProps {
  /** Map of bank app ID → bank display name */
  activeBanks: Map<string, string>;
  showDemoData?: boolean;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  secondsUntilNextScan?: number | null;
}

const formatCountdown = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
};

/**
 * Shows the banks currently being parsed for notifications at the top
 * of the Transaction Parsing page with a scan timer.
 */
const ActiveBanksCard: React.FC<ActiveBanksCardProps> = ({
  activeBanks,
  showDemoData = false,
  onRefresh,
  isRefreshing = false,
  secondsUntilNextScan,
}) => {
  const banks = Array.from(activeBanks.entries());

  return (
    <ParsingCard
      id="parsing-active-banks"
      colorScheme="blue"
      icon={
        <>
          <rect x="1" y="4" width="22" height="16" rx="2" />
          <line x1="1" y1="10" x2="23" y2="10" />
        </>
      }
      title="Banking Apps"
      subtitle="Covault AI is monitoring these apps for transactions"
      count={showDemoData && banks.length === 0 ? 2 : banks.length}
      headerAction={
        <div className="flex flex-col items-end gap-0.5">
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
            title="Scan now"
            aria-label="Scan for new transactions"
          >
            <svg
              className={`w-4 h-4 text-blue-500 dark:text-blue-400 ${isRefreshing ? 'animate-spin' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
          </button>
          {secondsUntilNextScan != null && secondsUntilNextScan > 0 && (
            <span className="text-[8px] font-bold text-slate-400 dark:text-slate-500 tabular-nums">
              next scan {formatCountdown(secondsUntilNextScan)}
            </span>
          )}
        </div>
      }
    >
      {banks.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {banks.map(([appId, name]) => (
            <div
              key={appId}
              className="flex items-center gap-2 px-4 py-2.5 bg-blue-50 dark:bg-blue-900/20 rounded-2xl border border-blue-100 dark:border-blue-800/30"
            >
              <div className="w-6 h-6 bg-blue-100 dark:bg-blue-800/40 rounded-full flex items-center justify-center">
                <svg className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <rect x="1" y="4" width="22" height="16" rx="2" />
                  <line x1="1" y1="10" x2="23" y2="10" />
                </svg>
              </div>
              <span className="text-xs font-bold text-slate-700 dark:text-slate-200 capitalize">
                {name}
              </span>
              <span className="text-[8px] font-black text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded-full uppercase tracking-wider">
                Active
              </span>
            </div>
          ))}
        </div>
      ) : showDemoData ? (
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-2 px-4 py-2.5 bg-blue-50 dark:bg-blue-900/20 rounded-2xl border border-blue-100 dark:border-blue-800/30">
            <div className="w-6 h-6 bg-blue-100 dark:bg-blue-800/40 rounded-full flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="4" width="22" height="16" rx="2" />
                <line x1="1" y1="10" x2="23" y2="10" />
              </svg>
            </div>
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">TD Bank</span>
            <span className="text-[8px] font-black text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded-full uppercase tracking-wider">Active</span>
          </div>
          <div className="flex items-center gap-2 px-4 py-2.5 bg-blue-50 dark:bg-blue-900/20 rounded-2xl border border-blue-100 dark:border-blue-800/30">
            <div className="w-6 h-6 bg-blue-100 dark:bg-blue-800/40 rounded-full flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="4" width="22" height="16" rx="2" />
                <line x1="1" y1="10" x2="23" y2="10" />
              </svg>
            </div>
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">RBC</span>
            <span className="text-[8px] font-black text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded-full uppercase tracking-wider">Active</span>
          </div>
        </div>
      ) : (
        <EmptyState
          icon={
            <svg className="w-6 h-6 text-slate-300 dark:text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="4" width="22" height="16" rx="2" />
              <line x1="1" y1="10" x2="23" y2="10" />
            </svg>
          }
          message="No banks detected yet"
          description="Banks will appear here once Covault AI detects transaction notifications."
          size="md"
        />
      )}
    </ParsingCard>
  );
};

export default ActiveBanksCard;

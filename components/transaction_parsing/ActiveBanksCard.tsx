import React from 'react';
import ParsingCard from '../ui/ParsingCard';
import { EmptyState } from '../shared';

interface ActiveBanksCardProps {
  /** Map of bank app ID → bank display name */
  activeBanks: Map<string, string>;
}

/**
 * Shows the banks currently being parsed for notifications at the top
 * of the Transaction Parsing page.
 */
const ActiveBanksCard: React.FC<ActiveBanksCardProps> = ({
  activeBanks,
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
      count={banks.length}
    >
      {banks.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {banks.map(([appId, name]) => (
            <div
              key={appId}
              className="flex items-center gap-2 px-4 py-2.5 bg-white/60 dark:bg-blue-900/20 backdrop-blur-sm rounded-2xl border border-blue-100 dark:border-blue-800/30 ring-1 ring-inset ring-white/10 dark:ring-white/[0.04]"
            >
              <div className="w-7 h-7 bg-blue-100 dark:bg-blue-800/40 rounded-xl flex items-center justify-center">
                <svg className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <rect x="1" y="4" width="22" height="16" rx="2" />
                  <line x1="1" y1="10" x2="23" y2="10" />
                </svg>
              </div>
              <span className="text-xs font-bold text-slate-700 dark:text-slate-200 capitalize">
                {name}
              </span>
              <span className="text-[8px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded-full tracking-wide">
                Active
              </span>
            </div>
          ))}
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

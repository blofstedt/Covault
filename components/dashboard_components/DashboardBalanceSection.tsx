import React from 'react';

interface DashboardBalanceSectionProps {
  isSharedAccount: boolean;
  remainingMoney: number;
  monthlyIncome: number;
  searchQuery: string;
  isSearchOpen: boolean;
  onSearchQueryChange: (value: string) => void;
  onSearchOpenChange: (open: boolean) => void;
  onOpenSettings: () => void;
}

const DashboardBalanceSection: React.FC<DashboardBalanceSectionProps> = ({
  isSharedAccount,
  remainingMoney,
  monthlyIncome,
  searchQuery,
  isSearchOpen,
  onSearchQueryChange,
  onSearchOpenChange,
  onOpenSettings,
}) => {
  const isNegative = remainingMoney < 0;
  const hasNoIncome = monthlyIncome === 0;

  return (
    <div
      id="balance-header"
      className="flex flex-col items-center justify-center pb-1 shrink-0 relative"
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
    >
      {/* Soft glow behind balance number */}
      <div
        className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-36 h-16 rounded-full blur-3xl opacity-20 transition-colors duration-700 pointer-events-none ${
          isNegative ? 'bg-rose-400' : 'bg-emerald-400'
        }`}
      />

      {/* Balance label + settings cog on one row */}
      <div className="w-full flex items-center justify-between px-4 z-10 animate-nest mb-0.5 relative">
        <span className="absolute left-0 right-0 text-center text-[10px] font-semibold tracking-widest uppercase transition-colors duration-700 text-slate-400 dark:text-slate-500 pointer-events-none">
          {isSharedAccount ? 'Our Remaining Balance' : 'Remaining Balance'}
        </span>
        <span></span>
        <button
          id="settings-button"
          onClick={onOpenSettings}
          className="p-2 transition-all duration-200 active:scale-[0.97] bg-white/50 dark:bg-slate-800/50 backdrop-blur-md rounded-xl text-slate-400 hover:text-emerald-600 ring-1 ring-inset ring-white/10 dark:ring-white/[0.04] shadow-sm"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </div>

      {hasNoIncome && (
        <button
          onClick={onOpenSettings}
          className="mb-1 z-10 text-[10px] font-semibold text-slate-400 dark:text-slate-500 tracking-wide hover:text-emerald-500 dark:hover:text-emerald-400 transition-colors"
        >
          Set monthly income in Settings →
        </button>
      )}

      <div className="text-center z-10 animate-nest">
        <div className="flex items-baseline justify-center space-x-1 transition-colors duration-700">
          <span
            className="text-xl font-bold leading-none"
            style={{
              background: isNegative
                ? 'linear-gradient(135deg, #f43f5e, #e11d48)'
                : 'linear-gradient(135deg, #34d399, #14b8a6)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            $
          </span>
          <span
            className="text-3xl font-extrabold font-mono tracking-tighter leading-none transition-all duration-700"
            style={{
              background: isNegative
                ? 'linear-gradient(135deg, #f43f5e, #e11d48)'
                : 'linear-gradient(135deg, #34d399, #14b8a6)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            {remainingMoney.toLocaleString()}
          </span>
        </div>
      </div>

      {isSearchOpen ? (
        <div
          id="search-field"
          className="relative mt-2 w-2/3 lg:w-1/3 z-10 animate-nest"
          style={{ animationDelay: '0.1s' }}
        >
          <input
            type="text"
            placeholder="Find entry..."
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            onFocus={() => onSearchOpenChange(true)}
            autoFocus
            className="w-full bg-white/70 dark:bg-slate-900/70 backdrop-blur-md border-2 rounded-2xl py-2.5 px-10 text-[12px] font-medium focus:ring-2 transition-all duration-200 placeholder-slate-400 shadow-sm text-center border-slate-100 dark:border-slate-800 focus:ring-emerald-500/20 dark:text-slate-100 ring-1 ring-inset ring-white/10 dark:ring-white/[0.04]"
          />
          <svg
            className="w-3.5 h-3.5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={3}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
      ) : (
        <button
          type="button"
          id="search-field"
          onClick={() => onSearchOpenChange(true)}
          className="mt-2 w-2/3 lg:w-1/3 inline-flex items-center justify-center gap-2 rounded-2xl border-2 border-slate-100 dark:border-slate-800 px-4 py-2 text-[12px] font-medium text-slate-400 dark:text-slate-500 bg-white/70 dark:bg-slate-900/70 hover:bg-white dark:hover:bg-slate-900 transition-all duration-200 active:scale-[0.97]"
        >
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={3}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          Find entry...
        </button>
      )}
    </div>
  );
};

export default DashboardBalanceSection;

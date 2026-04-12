import React from 'react';

interface DashboardBalanceSectionProps {
  isSharedAccount: boolean;
  remainingMoney: number;
  searchQuery: string;
  isSearchOpen: boolean;
  onSearchQueryChange: (value: string) => void;
  onSearchOpenChange: (open: boolean) => void;
}

const DashboardBalanceSection: React.FC<DashboardBalanceSectionProps> = ({
  isSharedAccount,
  remainingMoney,
  searchQuery,
  isSearchOpen,
  onSearchQueryChange,
  onSearchOpenChange,
}) => {
  const isNegative = remainingMoney < 0;

  return (
    <div
      id="balance-header"
      className="flex flex-col items-center justify-center pt-0 pb-2 shrink-0 relative"
    >
      {/* Soft glow behind balance number */}
      <div
        className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-24 rounded-full blur-3xl opacity-20 transition-colors duration-700 pointer-events-none ${
          isNegative ? 'bg-rose-400' : 'bg-emerald-400'
        }`}
      />

      <div className="text-center z-10 animate-nest">
        <span className="text-[10px] font-semibold tracking-widest uppercase mb-1.5 block transition-colors duration-700 text-slate-400 dark:text-slate-500">
          {isSharedAccount ? 'Our Remaining Balance' : 'Remaining Balance'}
        </span>
        <div className="flex items-baseline justify-center space-x-1 transition-colors duration-700">
          <span
            className="text-2xl font-bold leading-none"
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
            className="text-5xl font-extrabold font-mono tracking-tighter leading-none transition-all duration-700"
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

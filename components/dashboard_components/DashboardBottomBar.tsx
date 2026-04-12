import React from 'react';

interface DashboardBottomBarProps {
  onGoHome: () => void;
  onAddTransaction: () => void;
  onOpenParsing: () => void;
  activeView?: 'home' | 'parsing';
  shouldAnimate?: boolean;
  pendingCount?: number;
}

const DashboardBottomBar: React.FC<DashboardBottomBarProps> = ({
  onGoHome,
  onAddTransaction,
  onOpenParsing,
  activeView = 'home',
  shouldAnimate = false,
  pendingCount = 0,
}) => {
  return (
    <div
      id="bottom-bar"
      className="fixed bottom-0 left-0 right-0 z-40 h-[calc(env(safe-area-inset-bottom,0px)+5rem)] px-6 flex items-center justify-center pointer-events-none"
    >
      <div
        className={`w-2/3 lg:w-1/3 backdrop-blur-3xl border rounded-full px-3 py-1.5 lg:px-6 lg:py-2.5 pointer-events-auto shadow-2xl ring-1 ring-inset ring-white/10 dark:ring-white/[0.04] transition-all duration-700 bg-white/90 dark:bg-slate-900/90 border-slate-100 dark:border-slate-800/60 ${
          shouldAnimate ? 'animate-nest' : ''
        }`}
        style={shouldAnimate ? { animationDelay: '0.4s' } : undefined}
      >
        <div className="flex items-center justify-center gap-1 lg:justify-evenly lg:gap-0 w-full">
          {/* Home Button */}
          <button
            onClick={onGoHome}
            className={`p-3 rounded-full transition-all duration-200 active:scale-[0.97] ${
              activeView === 'home'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-slate-400 dark:text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400'
            }`}
            aria-label="Go to dashboard home"
          >
            <svg
              className="w-6 h-6 transition-all duration-200"
              viewBox="0 0 24 24"
              fill={activeView === 'home' ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth={activeView === 'home' ? 0 : 2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              {activeView !== 'home' && <polyline points="9 22 9 12 15 12 15 22" />}
            </svg>
          </button>

          {/* Divider */}
          <div className="w-px h-6 bg-slate-200/60 dark:bg-slate-700/40" />

          {/* Add Transaction Button */}
          <button
            id="add-transaction-button"
            onClick={onAddTransaction}
            className="p-3 mx-1 text-white rounded-full shadow-lg flex items-center justify-center active:scale-[0.97] transition-all duration-200 bg-emerald-600 dark:bg-emerald-500 hover:bg-emerald-700 dark:hover:bg-emerald-600 shadow-emerald-500/20"
            aria-label="Add transaction"
          >
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>

          {/* Divider */}
          <div className="w-px h-6 bg-slate-200/60 dark:bg-slate-700/40" />

          {/* Parsing Button */}
          <button
            onClick={onOpenParsing}
            className={`relative p-3 rounded-full transition-all duration-200 active:scale-[0.97] ${
              activeView === 'parsing'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-slate-400 dark:text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400'
            }`}
            aria-label="Open transaction parsing"
          >
            <svg
              className="w-6 h-6 transition-all duration-200"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={activeView === 'parsing' ? 2.5 : 2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
            {pendingCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-amber-500 text-white text-[10px] font-black flex items-center justify-center">
                {pendingCount > 99 ? '99+' : pendingCount}
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DashboardBottomBar;

import React from 'react';

interface DashboardBottomBarProps {
  onGoHome: () => void;
  onAddTransaction: () => void;
  onOpenParsing: () => void;
  activeView?: 'home' | 'parsing';
  shouldAnimate?: boolean;
}

const DashboardBottomBar: React.FC<DashboardBottomBarProps> = ({
  onGoHome,
  onAddTransaction,
  onOpenParsing,
  activeView = 'home',
  shouldAnimate = false,
}) => {
  return (
    <div
      id="bottom-bar"
      className="fixed bottom-0 left-0 right-0 z-40 px-4 pb-4 pt-2 flex flex-col items-center pointer-events-none pb-safe-bottom"
    >
      <div
        className={`w-full max-w-sm backdrop-blur-3xl border rounded-full px-6 py-2 pointer-events-auto shadow-2xl transition-all duration-700 bg-white/95 dark:bg-slate-900/95 border-slate-100 dark:border-slate-800/60 ${
          shouldAnimate ? 'animate-nest' : ''
        }`}
        style={shouldAnimate ? { animationDelay: '0.4s' } : undefined}
      >
        <div className="flex items-center justify-around gap-4 w-full">
          {/* Home Button */}
          <button
            onClick={onGoHome}
            className={`p-3 rounded-full transition-all duration-300 active:scale-95 ${
              activeView === 'home'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-slate-400 dark:text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400'
            }`}
            aria-label="Go to dashboard home"
          >
            <svg
              className="w-6 h-6"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </button>

          {/* Add Transaction Button */}
          <button
            id="add-transaction-button"
            onClick={onAddTransaction}
            className="p-3 text-white rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-all bg-slate-500 dark:bg-emerald-600"
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

          {/* Parsing Button */}
          <button
            onClick={onOpenParsing}
            className={`relative p-3 rounded-full transition-all duration-300 active:scale-95 ${
              activeView === 'parsing'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-slate-400 dark:text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400'
            }`}
            aria-label="Open transaction parsing"
          >
            <svg
              className="w-6 h-6"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default DashboardBottomBar;

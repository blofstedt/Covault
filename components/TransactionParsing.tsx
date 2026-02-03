import React from 'react';
import NotificationSettings from './NotificationSettings';

interface TransactionParsingProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  onBack: () => void;
}

const TransactionParsing: React.FC<TransactionParsingProps> = ({
  enabled,
  onToggle,
  onBack,
}) => {
  return (
    <div className="flex-1 flex flex-col h-screen relative overflow-hidden transition-colors duration-700 bg-slate-50 dark:bg-slate-950">
      {/* Background glow */}
      <div className="absolute top-0 left-0 right-0 h-[320px] z-0 flex items-center justify-center pointer-events-none overflow-visible transition-opacity duration-700 animate-nest">
        <div className="w-80 h-80 rounded-full blur-[90px] animate-blob translate-x-20 -translate-y-16 transition-colors duration-1000 bg-emerald-400/25 dark:bg-emerald-500/35"></div>
        <div className="w-72 h-72 rounded-full blur-[80px] animate-blob animation-delay-4000 -translate-x-24 translate-y-8 transition-colors duration-1000 bg-green-300/20 dark:bg-green-400/30"></div>
      </div>

      {/* Header */}
      <header
        className="px-6 pt-safe-top pb-4 sticky top-0 z-20 transition-colors bg-transparent border-none backdrop-blur-none relative z-10"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1.5rem)' }}
      >
        <div className="flex items-center justify-between">
          <button
            onClick={onBack}
            className="p-3 bg-white dark:bg-slate-900 rounded-full transition-transform active:scale-90 shadow-sm border border-slate-100 dark:border-slate-800/60"
            aria-label="Go back"
          >
            <svg
              className="w-6 h-6 text-slate-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={3}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
          
          <h1 className="text-xl font-black text-slate-500 dark:text-slate-100 tracking-tight uppercase">
            Transaction Parsing
          </h1>
          
          <div className="w-12" aria-hidden="true" /> {/* Spacer for centering */}
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col p-6 pb-28 overflow-y-auto relative z-10">
        <div className="max-w-2xl mx-auto w-full space-y-6">
          {/* Info card */}
          <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 shadow-xl border border-slate-100 dark:border-slate-800/60 space-y-6">
            <div className="flex items-start space-x-4">
              <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl">
                <svg
                  className="w-8 h-8 text-emerald-600 dark:text-emerald-400"
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
              </div>
              
              <div className="flex-1">
                <h2 className="text-lg font-black text-slate-500 dark:text-slate-100 tracking-tight uppercase mb-2">
                  Automatic Transaction Detection
                </h2>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  Configure transaction parsing from banking app notifications. When enabled, Covault can automatically detect and add transactions from your bank notifications.
                </p>
              </div>
            </div>

            {/* NotificationSettings Component */}
            <NotificationSettings
              enabled={enabled}
              onToggle={onToggle}
            />

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
              <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-tight text-center">
                Auto-detected transactions will appear in your budgets automatically. You can review and edit them at any time.
              </p>
            </div>
          </div>

          {/* Help section */}
          <div className="bg-slate-100 dark:bg-slate-800/50 rounded-2xl p-6 space-y-4">
            <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              How it works
            </h3>
            
            <div className="space-y-3">
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0 w-6 h-6 bg-emerald-500 text-white rounded-full flex items-center justify-center text-xs font-bold">
                  1
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Enable transaction parsing and grant notification access
                </p>
              </div>
              
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0 w-6 h-6 bg-emerald-500 text-white rounded-full flex items-center justify-center text-xs font-bold">
                  2
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Covault listens for banking notifications on your device
                </p>
              </div>
              
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0 w-6 h-6 bg-emerald-500 text-white rounded-full flex items-center justify-center text-xs font-bold">
                  3
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Transactions are automatically parsed and added to your budgets
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default TransactionParsing;

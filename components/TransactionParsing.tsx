import React from 'react';
import NotificationSettings from './NotificationSettings';

interface TransactionParsingProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

const TransactionParsing: React.FC<TransactionParsingProps> = ({
  enabled,
  onToggle,
}) => {
  return (
    <div className="flex-1 flex flex-col h-full relative overflow-hidden transition-colors duration-700 bg-slate-50 dark:bg-slate-950">
      {/* Background glow */}
      <div className="absolute top-0 left-0 right-0 h-[320px] z-0 flex items-center justify-center pointer-events-none overflow-visible transition-opacity duration-700">
        <div className="w-80 h-80 rounded-full blur-[90px] animate-blob translate-x-20 -translate-y-16 transition-colors duration-1000 bg-emerald-400/25 dark:bg-emerald-500/35"></div>
        <div className="w-72 h-72 rounded-full blur-[80px] animate-blob animation-delay-4000 -translate-x-24 translate-y-8 transition-colors duration-1000 bg-green-300/20 dark:bg-green-400/30"></div>
      </div>

      {/* Header */}
      <header
        className="px-6 pt-safe-top pb-2 sticky top-0 z-20 transition-colors bg-transparent border-none backdrop-blur-none relative z-10"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}
      >
        <div className="flex items-center justify-center">
          <h1 className="text-lg font-black text-slate-500 dark:text-slate-100 tracking-tight uppercase">
            Transaction Parsing
          </h1>
        </div>
      </header>

      {/* Main content - reduced padding */}
      <main className="flex-1 flex flex-col p-4 pb-24 overflow-hidden relative z-10">
        <div className="max-w-2xl mx-auto w-full space-y-4">
          {/* Info card - more compact */}
          <div className="bg-white dark:bg-slate-900 rounded-[2rem] p-5 shadow-xl border border-slate-100 dark:border-slate-800/60 space-y-4">
            <div className="flex items-start space-x-3">
              <div className="p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl">
                <svg
                  className="w-6 h-6 text-emerald-600 dark:text-emerald-400"
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
                <h2 className="text-base font-black text-slate-500 dark:text-slate-100 tracking-tight uppercase mb-1">
                  Auto Transaction Detection
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Covault can automatically detect and add transactions from your bank notifications.
                </p>
              </div>
            </div>

            {/* NotificationSettings Component */}
            <NotificationSettings
              enabled={enabled}
              onToggle={onToggle}
            />

            <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
              <p className="text-[9px] text-slate-400 dark:text-slate-500 leading-tight text-center">
                Auto-detected transactions appear in your budgets automatically.
              </p>
            </div>
          </div>

          {/* Help section - more compact */}
          <div className="bg-slate-100 dark:bg-slate-800/50 rounded-xl p-4 space-y-3">
            <h3 className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">
              How it works
            </h3>
            
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <div className="flex-shrink-0 w-5 h-5 bg-emerald-500 text-white rounded-full flex items-center justify-center text-[10px] font-bold">
                  1
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  Enable parsing and grant notification access
                </p>
              </div>
              
              <div className="flex items-center space-x-2">
                <div className="flex-shrink-0 w-5 h-5 bg-emerald-500 text-white rounded-full flex items-center justify-center text-[10px] font-bold">
                  2
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  Covault listens for banking notifications
                </p>
              </div>
              
              <div className="flex items-center space-x-2">
                <div className="flex-shrink-0 w-5 h-5 bg-emerald-500 text-white rounded-full flex items-center justify-center text-[10px] font-bold">
                  3
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  Transactions are parsed and added to budgets
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

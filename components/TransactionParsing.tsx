import React from 'react';
import NotificationSettings from './NotificationSettings';
import DashboardBottomBar from './dashboard_components/DashboardBottomBar';
import { Transaction } from '../types';

interface TransactionParsingProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  onBack: () => void;
  onAddTransaction: () => void;
  onGoHome: () => void;
  autoDetectedTransactions?: Transaction[];
  onTransactionTap?: (tx: Transaction) => void;
}

const TransactionParsing: React.FC<TransactionParsingProps> = ({
  enabled,
  onToggle,
  onBack,
  onAddTransaction,
  onGoHome,
  autoDetectedTransactions = [],
  onTransactionTap,
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
        className="px-6 pt-safe-top pb-2 sticky top-0 z-20 transition-colors bg-transparent border-none backdrop-blur-none relative z-10"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}
      >
        <div className="flex items-center justify-center">
          <h1 className="text-xl font-black text-slate-500 dark:text-slate-100 tracking-tight uppercase">
            Transaction Parsing
          </h1>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col p-4 pb-24 overflow-y-auto relative z-10">
        <div className="max-w-2xl mx-auto w-full space-y-4">
          {enabled ? (
            <>
              {/* Active state: toggle + captured transactions */}
              <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-xl border border-slate-100 dark:border-slate-800/60 space-y-4">
                {/* NotificationSettings Component (toggle + app picker) */}
                <NotificationSettings
                  enabled={enabled}
                  onToggle={onToggle}
                />
              </div>

              {/* Captured Transactions */}
              <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-xl border border-slate-100 dark:border-slate-800/60 space-y-4">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl">
                    <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                      Captured Transactions
                    </h3>
                    <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                      Auto-detected from bank notifications
                    </p>
                  </div>
                </div>

                {autoDetectedTransactions.length > 0 ? (
                  <div className="space-y-2">
                    {autoDetectedTransactions.map((tx) => (
                      <button
                        key={tx.id}
                        onClick={() => onTransactionTap?.(tx)}
                        className="w-full flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800/60 transition-all active:scale-[0.98]"
                      >
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center">
                            <svg className="w-4 h-4 text-amber-600 dark:text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                            </svg>
                          </div>
                          <div className="text-left">
                            <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate max-w-[160px]">
                              {tx.vendor}
                            </p>
                            <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                              {new Date(tx.date).toLocaleDateString()} • {tx.budget_id ? 'Categorized' : 'Needs review'}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-black text-slate-700 dark:text-slate-200">
                            ${tx.amount.toFixed(2)}
                          </span>
                          {!tx.budget_id && (
                            <p className="text-[8px] font-bold uppercase tracking-wider text-amber-500 dark:text-amber-400 mt-0.5">
                              Tap to review
                            </p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="py-8 text-center">
                    <div className="w-12 h-12 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-3">
                      <svg className="w-6 h-6 text-slate-300 dark:text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                      </svg>
                    </div>
                    <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                      No notifications captured yet
                    </p>
                    <p className="text-[10px] text-slate-400 dark:text-slate-600 mt-1 leading-relaxed max-w-xs mx-auto">
                      When your banking apps send notifications, they'll appear here for review.
                    </p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Setup state: info card + toggle + how it works */}
              <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-xl border border-slate-100 dark:border-slate-800/60 space-y-4">
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
              <div className="bg-slate-100 dark:bg-slate-800/50 rounded-2xl p-4 space-y-3">
                <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                  How it works
                </h3>
                
                <div className="flex flex-col gap-4">
                  <div className="flex items-center space-x-3">
                    <div className="flex-shrink-0 w-7 h-7 bg-emerald-500 text-white rounded-full flex items-center justify-center text-xs font-bold">
                      1
                    </div>
                    <span className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      Enable transaction parsing and grant notification access
                    </span>
                  </div>

                  <div className="flex items-center space-x-3">
                    <div className="flex-shrink-0 w-7 h-7 bg-emerald-500 text-white rounded-full flex items-center justify-center text-xs font-bold">
                      2
                    </div>
                    <span className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      Covault listens for banking notifications on your device
                    </span>
                  </div>

                  <div className="flex items-center space-x-3">
                    <div className="flex-shrink-0 w-7 h-7 bg-emerald-500 text-white rounded-full flex items-center justify-center text-xs font-bold">
                      3
                    </div>
                    <span className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      Transactions are automatically parsed and added to your budgets
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </main>

      <DashboardBottomBar
        onGoHome={onGoHome}
        onAddTransaction={onAddTransaction}
        onOpenParsing={onBack}
        activeView="parsing"
      />
    </div>
  );
};

export default TransactionParsing;

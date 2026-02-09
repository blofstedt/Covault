import React, { useState, useMemo, useCallback } from 'react';
import NotificationSettings from './NotificationSettings';
import DashboardBottomBar from './dashboard_components/DashboardBottomBar';
import RegexSetupModal from './RegexSetupModal';
import { PendingTransaction, BudgetCategory, Transaction } from '../types';
import {
  saveNotificationRule,
  reprocessUnconfiguredCaptures,
} from '../lib/notificationProcessor';

interface TransactionParsingProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  onBack: () => void;
  onAddTransaction: () => void;
  onGoHome: () => void;
  autoDetectedTransactions?: Transaction[];
  onTransactionTap?: (tx: Transaction) => void;
  pendingTransactions?: PendingTransaction[];
  budgets?: BudgetCategory[];
  onApprovePending?: (pendingId: string, categoryId: string) => void;
  onRejectPending?: (pendingId: string) => void;
  onRefreshNotifications?: () => Promise<void>;
  userId?: string;
  onPendingTransactionsUpdated?: (updated: PendingTransaction[]) => void;
}

const TransactionParsing: React.FC<TransactionParsingProps> = ({
  enabled,
  onToggle,
  onBack,
  onAddTransaction,
  onGoHome,
  autoDetectedTransactions = [],
  onTransactionTap,
  pendingTransactions = [],
  budgets = [],
  onApprovePending,
  onRejectPending,
  onRefreshNotifications,
  userId,
  onPendingTransactionsUpdated,
}) => {
  const [expandedPendingId, setExpandedPendingId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [setupNotification, setSetupNotification] = useState<PendingTransaction | null>(null);
  const [savingRule, setSavingRule] = useState(false);

  // ── Categorize pending transactions into three sections ──

  // 1. Captured: no rule configured (pattern_id is null)
  const capturedNotifications = useMemo(
    () => pendingTransactions.filter(
      (pt) => !pt.pattern_id && pt.needs_review,
    ),
    [pendingTransactions],
  );

  // 2. Set Category: rule matched, vendor/amount extracted, but needs category
  //    These have a pattern_id and needs_review=true and validation_reasons='OK'
  const needsCategoryTransactions = useMemo(
    () => pendingTransactions.filter(
      (pt) =>
        pt.pattern_id &&
        pt.needs_review &&
        pt.validation_reasons === 'OK',
    ),
    [pendingTransactions],
  );

  // 3. Pending Approval: has everything, user can approve or auto-approve is pending
  //    For now, these show in the same "Set Category" flow since the user picks a category
  //    and approves in one step. The "Pending Approval" section is for transactions
  //    that already have a vendor_override (category is known).
  //    We'll show them together in Set Category for the approval + category assignment.

  // Group captured notifications by bank app
  const capturedByBank = useMemo(() => {
    const groups = new Map<string, PendingTransaction[]>();
    for (const pt of capturedNotifications) {
      const key = pt.app_name || pt.app_package;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(pt);
    }
    return groups;
  }, [capturedNotifications]);

  const totalPendingCount = needsCategoryTransactions.length;
  const totalCapturedCount = capturedNotifications.length;

  // Handle saving a regex rule from the setup modal
  const handleSaveRule = useCallback(
    async (amountRegex: string, vendorRegex: string) => {
      if (!setupNotification || !userId) return;

      setSavingRule(true);
      try {
        const rule = await saveNotificationRule({
          userId,
          bankAppId: setupNotification.app_package,
          bankName: setupNotification.app_name,
          amountRegex,
          vendorRegex,
          sampleNotification: setupNotification.notification_text,
        });

        if (rule) {
          // Re-process all unconfigured captures for this bank
          await reprocessUnconfiguredCaptures(userId, setupNotification.app_package, rule);

          // Notify parent to refresh pending transactions
          if (onRefreshNotifications) {
            await onRefreshNotifications();
          }
        }

        setSetupNotification(null);
      } catch (err) {
        console.error('[TransactionParsing] Error saving rule:', err);
      } finally {
        setSavingRule(false);
      }
    },
    [setupNotification, userId, onRefreshNotifications],
  );

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
              {/* Active state: toggle + app picker */}
              <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-xl border border-slate-100 dark:border-slate-800/60 space-y-4">
                <NotificationSettings
                  enabled={enabled}
                  onToggle={onToggle}
                />
              </div>

              {/* ──────────────────────────────────────────────────── */}
              {/* SECTION 1: Captured Notifications (needs rule setup) */}
              {/* ──────────────────────────────────────────────────── */}
              {totalCapturedCount > 0 && (
                <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-xl border border-blue-200 dark:border-blue-800/40 space-y-4">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-xl">
                      <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                        Captured Notifications
                      </h3>
                      <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                        Tap a notification to teach Covault how to read it
                      </p>
                    </div>
                    <span className="text-[10px] font-black bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2.5 py-1 rounded-full">
                      {totalCapturedCount}
                    </span>
                  </div>

                  {Array.from(capturedByBank.entries()).map(([bankName, notifications]) => (
                    <div key={bankName} className="space-y-2">
                      <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-1">
                        {bankName}
                        {!notifications[0]?.pattern_id && (
                          <span className="ml-2 text-blue-500 dark:text-blue-400">
                            — needs setup
                          </span>
                        )}
                      </p>

                      {notifications.map((pt) => (
                        <button
                          key={pt.id}
                          onClick={() => setSetupNotification(pt)}
                          className="w-full flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-blue-100 dark:border-blue-800/30 transition-all active:scale-[0.98]"
                        >
                          <div className="flex items-center space-x-3">
                            <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center shrink-0">
                              <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </div>
                            <div className="text-left min-w-0">
                              <p className="text-[10px] text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-2">
                                {pt.notification_text}
                              </p>
                              <p className="text-[8px] text-slate-400 dark:text-slate-500 mt-0.5">
                                {new Date(pt.posted_at).toLocaleString()}
                              </p>
                            </div>
                          </div>
                          <div className="shrink-0 ml-2">
                            <span className="text-[8px] font-black uppercase tracking-wider text-blue-500 dark:text-blue-400">
                              Set up
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {/* ──────────────────────────────────────────────────── */}
              {/* SECTION 2: Set Category (regex matched, needs category) */}
              {/* ──────────────────────────────────────────────────── */}
              {totalPendingCount > 0 && (
                <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-xl border border-amber-200 dark:border-amber-800/40 space-y-4">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-amber-50 dark:bg-amber-900/20 rounded-xl">
                      <svg className="w-5 h-5 text-amber-600 dark:text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                        Set Category
                      </h3>
                      <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                        Assign a budget category to approve these transactions
                      </p>
                    </div>
                    <span className="text-[10px] font-black bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-2.5 py-1 rounded-full">
                      {totalPendingCount}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {needsCategoryTransactions.map((pt) => {
                      const isExpanded = expandedPendingId === pt.id;

                      return (
                        <div key={pt.id} className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800/60 overflow-hidden">
                          {/* Card header */}
                          <button
                            onClick={() => setExpandedPendingId(isExpanded ? null : pt.id)}
                            className="w-full flex items-center justify-between p-4 transition-all active:scale-[0.99]"
                          >
                            <div className="flex items-center space-x-3">
                              <div className="w-8 h-8 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center shrink-0">
                                <svg className="w-4 h-4 text-amber-600 dark:text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                                </svg>
                              </div>
                              <div className="text-left min-w-0">
                                <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate max-w-[160px]">
                                  {pt.extracted_vendor}
                                </p>
                                <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                                  {pt.app_name}
                                </p>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <span className="text-sm font-black text-slate-700 dark:text-slate-200">
                                ${pt.extracted_amount.toFixed(2)}
                              </span>
                              <p className="text-[8px] font-bold uppercase tracking-wider text-amber-500 dark:text-amber-400 mt-0.5">
                                {isExpanded ? 'Collapse' : 'Tap to categorize'}
                              </p>
                            </div>
                          </button>

                          {/* Expanded: notification preview + category picker + actions */}
                          {isExpanded && (
                            <div className="px-4 pb-4 space-y-3 border-t border-slate-100 dark:border-slate-800/60 pt-3">
                              {/* Notification text preview */}
                              <div className="bg-slate-100 dark:bg-slate-800/80 rounded-xl p-3">
                                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">Notification</p>
                                <p className="text-[10px] text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-3">
                                  {pt.notification_text}
                                </p>
                              </div>

                              {/* Category picker */}
                              <div>
                                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">Assign Category & Approve</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {budgets.map((b) => (
                                    <button
                                      key={b.id}
                                      onClick={() => {
                                        onApprovePending?.(pt.id, b.id);
                                        setExpandedPendingId(null);
                                      }}
                                      className="px-3 py-1.5 text-[10px] font-bold rounded-full border transition-all active:scale-95 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
                                    >
                                      {b.name}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              {/* Reject button */}
                              <button
                                onClick={() => {
                                  onRejectPending?.(pt.id);
                                  setExpandedPendingId(null);
                                }}
                                className="w-full py-2 text-[10px] font-bold uppercase tracking-wider text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/10 rounded-xl border border-red-200 dark:border-red-800/30 transition-all active:scale-[0.98] hover:bg-red-100 dark:hover:bg-red-900/20"
                              >
                                Reject
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ──────────────────────────────────────────────────── */}
              {/* SECTION 3: Approved Transactions (history) */}
              {/* ──────────────────────────────────────────────────── */}
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
                  <div className="flex-1">
                    <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                      Approved Transactions
                    </h3>
                    <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                      Auto-detected and approved from bank notifications
                    </p>
                  </div>
                  {onRefreshNotifications && (
                    <button
                      onClick={async () => {
                        if (isRefreshing) return;
                        setIsRefreshing(true);
                        try {
                          await onRefreshNotifications();
                        } finally {
                          setIsRefreshing(false);
                        }
                      }}
                      disabled={isRefreshing}
                      className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 transition-all active:scale-95 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
                      title="Scan notifications"
                    >
                      <svg
                        className={`w-4 h-4 text-emerald-600 dark:text-emerald-400 ${isRefreshing ? 'animate-spin' : ''}`}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="23 4 23 10 17 10" />
                        <polyline points="1 20 1 14 7 14" />
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                      </svg>
                    </button>
                  )}
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
                          <div className="w-8 h-8 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center">
                            <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </div>
                          <div className="text-left">
                            <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate max-w-[160px]">
                              {tx.vendor}
                            </p>
                            <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                              {new Date(tx.date).toLocaleDateString()} — Added automatically
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-black text-slate-700 dark:text-slate-200">
                            ${tx.amount.toFixed(2)}
                          </span>
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
                      No transactions captured yet
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
                      Transaction Detection
                    </h2>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                      Teach Covault to detect transactions from your banking app notifications. You set it up once per bank — just highlight the vendor and amount in a sample notification.
                    </p>
                  </div>
                </div>

                <NotificationSettings
                  enabled={enabled}
                  onToggle={onToggle}
                />

                <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-tight text-center">
                    No AI — your data stays on your device. You control exactly how transactions are detected.
                  </p>
                </div>
              </div>

              {/* How it works */}
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
                      Enable parsing and grant notification access
                    </span>
                  </div>

                  <div className="flex items-center space-x-3">
                    <div className="flex-shrink-0 w-7 h-7 bg-emerald-500 text-white rounded-full flex items-center justify-center text-xs font-bold">
                      2
                    </div>
                    <span className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      Tap a captured notification and highlight the vendor name and dollar amount
                    </span>
                  </div>

                  <div className="flex items-center space-x-3">
                    <div className="flex-shrink-0 w-7 h-7 bg-emerald-500 text-white rounded-full flex items-center justify-center text-xs font-bold">
                      3
                    </div>
                    <span className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      Future notifications are automatically parsed — assign categories and approve
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
        pendingCount={totalPendingCount + totalCapturedCount}
      />

      {/* Regex Setup Modal */}
      {setupNotification && (
        <RegexSetupModal
          notification={setupNotification}
          onSave={handleSaveRule}
          onClose={() => setSetupNotification(null)}
        />
      )}
    </div>
  );
};

export default TransactionParsing;

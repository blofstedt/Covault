import React from 'react';
import { PendingTransaction, BudgetCategory } from '../../types';
import type { VendorOverride } from './useVendorOverrides';

interface ToBeReviewedCardProps {
  toReviewTransactions: PendingTransaction[];
  toReviewCount: number;
  expandedPendingId: string | null;
  vendorOverrideByName: Map<string, VendorOverride>;
  categoryNameById: Map<string, string>;
  budgets: BudgetCategory[];
  showDemoData: boolean;
  isScanning: boolean;
  onSetExpandedPendingId: (id: string | null) => void;
  onApprovePending?: (pendingId: string, categoryId: string) => void | Promise<void>;
  onRejectConfirm: (id: string) => void;
  onLoadVendorOverrides: () => Promise<void>;
  onScanForTransactions: () => void;
}

const ToBeReviewedCard: React.FC<ToBeReviewedCardProps> = ({
  toReviewTransactions,
  toReviewCount,
  expandedPendingId,
  vendorOverrideByName,
  categoryNameById,
  budgets,
  showDemoData,
  isScanning,
  onSetExpandedPendingId,
  onApprovePending,
  onRejectConfirm,
  onLoadVendorOverrides,
  onScanForTransactions,
}) => (
  <div id="parsing-to-review-section" className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-xl border border-amber-200 dark:border-amber-800/40 space-y-4">
    <div className="flex items-center space-x-3">
      <div className="p-2 bg-amber-50 dark:bg-amber-900/20 rounded-xl">
        <svg className="w-5 h-5 text-amber-600 dark:text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
        </svg>
      </div>
      <div className="flex-1">
        <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
          To Be Reviewed
        </h3>
        <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
          {toReviewCount > 0
            ? 'Assign a budget category to approve these transactions'
            : 'No transactions to review'}
        </p>
      </div>
      {toReviewCount > 0 && (
        <span className="text-[10px] font-black bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-2.5 py-1 rounded-full">
          {toReviewCount}
        </span>
      )}
    </div>

    {(toReviewCount > 0 || (showDemoData && toReviewCount === 0)) ? (
      <div className="space-y-2">
        {toReviewCount > 0 ? toReviewTransactions.map((pt) => {
          const isExpanded = expandedPendingId === pt.id;
          const vendorOverride = vendorOverrideByName.get(pt.extracted_vendor.toLowerCase());
          const defaultCategoryName = vendorOverride?.category_id
            ? (vendorOverride.category_name || categoryNameById.get(vendorOverride.category_id))
            : undefined;

          return (
            <div key={pt.id} className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800/60 overflow-hidden">
              {/* Card header */}
              <button
                onClick={() => onSetExpandedPendingId(isExpanded ? null : pt.id)}
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
                  {defaultCategoryName ? (
                    <p className="text-[8px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mt-0.5">
                      {defaultCategoryName}
                    </p>
                  ) : (
                    <p className="text-[8px] font-bold uppercase tracking-wider text-amber-500 dark:text-amber-400 mt-0.5">
                      {isExpanded ? 'Collapse' : 'Tap to categorize'}
                    </p>
                  )}
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
                          onClick={async () => {
                            await onApprovePending?.(pt.id, b.id);
                            onSetExpandedPendingId(null);
                            // Reload vendor overrides since approval may create one
                            await onLoadVendorOverrides();
                          }}
                          className={`px-3 py-1.5 text-[10px] font-bold rounded-full border transition-all active:scale-95 ${
                            vendorOverride?.category_id === b.id
                              ? 'bg-emerald-500 text-white border-emerald-600'
                              : 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40'
                          }`}
                        >
                          {b.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Reject button */}
                  <button
                    onClick={() => {
                      onRejectConfirm(pt.id);
                    }}
                    className="w-full py-2 text-[10px] font-bold uppercase tracking-wider text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/10 rounded-xl border border-red-200 dark:border-red-800/30 transition-all active:scale-[0.98] hover:bg-red-100 dark:hover:bg-red-900/20"
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          );
        }) : showDemoData && (
          <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800/60 overflow-hidden">
            <div className="w-full flex items-center justify-between p-4">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4 text-amber-600 dark:text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                  </svg>
                </div>
                <div className="text-left min-w-0">
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate max-w-[160px]">
                    Gas Station
                  </p>
                  <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                    Example Bank
                  </p>
                </div>
              </div>
              <div className="text-right shrink-0">
                <span className="text-sm font-black text-slate-700 dark:text-slate-200">
                  $45.00
                </span>
                <p className="text-[8px] font-bold uppercase tracking-wider text-amber-500 dark:text-amber-400 mt-0.5">
                  Demo
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    ) : (
      <div className="py-6 text-center">
        <div className="w-10 h-10 bg-amber-50 dark:bg-amber-900/20 rounded-full flex items-center justify-center mx-auto mb-2">
          <svg className="w-5 h-5 text-amber-400 dark:text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
          No Transactions to Review
        </p>
      </div>
    )}

    {/* Scan for Transactions button */}
    <button
      onClick={onScanForTransactions}
      disabled={isScanning}
      className="w-full py-2.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800/40 transition-all active:scale-[0.98] hover:bg-amber-100 dark:hover:bg-amber-900/30 disabled:opacity-50"
    >
      {isScanning ? 'Scanning…' : 'Scan for Transactions'}
    </button>
  </div>
);

export default ToBeReviewedCard;

import React, { useState } from 'react';
import { PendingTransaction, BudgetCategory } from '../../types';
import type { VendorOverride } from './useVendorOverrides';
import { formatVendorName } from '../../lib/formatVendorName';
import { toVendorKey } from '../../lib/deviceTransactionParser';
import ParsingCard from '../ui/ParsingCard';
import { EmptyState } from '../shared';

interface ToBeReviewedCardProps {
  toReviewTransactions: PendingTransaction[];
  toReviewCount: number;
  expandedPendingId: string | null;
  vendorOverrideByName: Map<string, VendorOverride>;
  categoryNameById: Map<string, string>;
  budgets: BudgetCategory[];
  isScanning: boolean;
  onSetExpandedPendingId: (id: string | null) => void;
  onApprovePending?: (pendingId: string, categoryId: string, preferredName?: string) => void | Promise<void>;
  onRejectConfirm: (id: string) => void;
  onLoadVendorOverrides: () => Promise<void>;
  onUpsertLocalVendorOverride: (vendorName: string, categoryId: string, properName?: string) => void;
  onScanForTransactions: () => void;
}

const ToBeReviewedCard: React.FC<ToBeReviewedCardProps> = ({
  toReviewTransactions,
  toReviewCount,
  expandedPendingId,
  vendorOverrideByName,
  categoryNameById,
  budgets,
  isScanning,
  onSetExpandedPendingId,
  onApprovePending,
  onRejectConfirm,
  onLoadVendorOverrides,
  onUpsertLocalVendorOverride,
  onScanForTransactions,
}) => {
  const [preferredNames, setPreferredNames] = useState<Record<string, string>>({});
  const [selectedCategories, setSelectedCategories] = useState<Record<string, string>>({});

  return (
  <ParsingCard
    id="parsing-to-review-section"
    colorScheme="amber"
    icon={<path d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />}
    title="To Be Reviewed"
    subtitle={toReviewCount > 0 ? 'Assign a budget category to approve these transactions' : 'No transactions to review'}
    count={toReviewCount}
  >
    {toReviewCount > 0 ? (
      <div className="space-y-2">
        {toReviewCount > 0 ? toReviewTransactions.map((pt) => {
          const isExpanded = expandedPendingId === pt.id;
          const vendorOverride = vendorOverrideByName.get(toVendorKey(pt.extracted_vendor));
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
                <div className="flex items-center space-x-3 min-w-0 flex-1">
                  <div className="w-8 h-8 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4 text-amber-600 dark:text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                    </svg>
                  </div>
                  <div className="text-left min-w-0">
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">
                      {vendorOverride?.proper_name || pt.extracted_vendor}
                    </p>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                      {pt.app_name}
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <span className="text-sm font-black text-slate-700 dark:text-slate-200">
                    ${pt.extracted_amount.toFixed(2)}
                  </span>
                  {defaultCategoryName ? (
                    <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mt-0.5">
                      {defaultCategoryName}
                    </p>
                  ) : (
                    <p className="text-[11px] font-bold uppercase tracking-wider text-amber-500 dark:text-amber-400 mt-0.5">
                      {isExpanded ? 'Collapse' : 'Tap to categorize'}
                    </p>
                  )}
                </div>
              </button>

              {/* Expanded: notification preview + preferred name + category picker + actions */}
              {isExpanded && (
                <div className="px-4 pb-4 space-y-3 border-t border-slate-100 dark:border-slate-800/60 pt-3">
                  {/* Notification text preview */}
                  <div className="bg-slate-100 dark:bg-slate-800/80 rounded-xl p-3">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">Detected</p>
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-3">
                      {pt.extracted_vendor} — ${pt.extracted_amount}
                    </p>
                  </div>

                  {/* Preferred name input */}
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">Preferred Name</p>
                    <input
                      type="text"
                      placeholder={pt.extracted_vendor}
                      value={preferredNames[pt.id] ?? ''}
                      onChange={(e) => setPreferredNames(prev => ({ ...prev, [pt.id]: e.target.value }))}
                      className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 placeholder-slate-300 dark:placeholder-slate-600 outline-none focus:border-amber-400 dark:focus:border-amber-500 transition-colors"
                    />
                  </div>

                  {/* Category picker */}
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">Assign Category</p>
                    <div className="flex flex-wrap gap-1.5">
                      {budgets.map((b) => (
                        <button
                          key={b.id}
                          onClick={() => {
                            setSelectedCategories(prev => ({ ...prev, [pt.id]: b.id }));
                          }}
                          className={`px-3 py-1.5 text-[11px] font-bold rounded-full border transition-all active:scale-95 ${
                            selectedCategories[pt.id] === b.id
                              ? 'bg-emerald-500 text-white border-emerald-600'
                              : vendorOverride?.category_id === b.id
                                ? 'bg-emerald-100 dark:bg-emerald-900/30 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300'
                                : 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40'
                          }`}
                        >
                          {b.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Submit button */}
                  <button
                    disabled={!selectedCategories[pt.id]}
                    onClick={async () => {
                      const categoryId = selectedCategories[pt.id];
                      if (!categoryId) return;
                      const preferred = preferredNames[pt.id]?.trim() || undefined;
                      // Create vendor override only on submit (after user confirms)
                      onUpsertLocalVendorOverride(formatVendorName(pt.extracted_vendor), categoryId, preferred);
                      await onApprovePending?.(pt.id, categoryId, preferred);
                      setPreferredNames(prev => { const { [pt.id]: _, ...rest } = prev; return rest; });
                      setSelectedCategories(prev => { const { [pt.id]: _, ...rest } = prev; return rest; });
                      onSetExpandedPendingId(null);
                      // Reload vendor overrides to sync with DB (replaces temp ID with real one)
                      await onLoadVendorOverrides();
                    }}
                    className={`w-full py-2.5 text-[11px] font-bold uppercase tracking-wider rounded-xl border transition-all active:scale-[0.98] ${
                      selectedCategories[pt.id]
                        ? 'text-white bg-emerald-500 border-emerald-600 hover:bg-emerald-600 dark:bg-emerald-600 dark:border-emerald-700 dark:hover:bg-emerald-700'
                        : 'text-slate-400 dark:text-slate-600 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 cursor-not-allowed'
                    }`}
                  >
                    Submit
                  </button>

                  {/* Reject button */}
                  <button
                    onClick={() => {
                      onRejectConfirm(pt.id);
                    }}
                    className="w-full py-2 text-[11px] font-bold uppercase tracking-wider text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/10 rounded-xl border border-red-200 dark:border-red-800/30 transition-all active:scale-[0.98] hover:bg-red-100 dark:hover:bg-red-900/20"
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          );
        }) : null}
      </div>
    ) : (
      <EmptyState
        icon={
          <svg className="w-5 h-5 text-amber-400 dark:text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        }
        message="No Transactions to Review"
      />
    )}

    {/* Scan for Transactions button */}
    <button
      onClick={onScanForTransactions}
      disabled={isScanning}
      className="w-full py-2.5 text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800/40 transition-all active:scale-[0.98] hover:bg-amber-100 dark:hover:bg-amber-900/30 disabled:opacity-50"
    >
      {isScanning ? 'Scanning…' : 'Scan for Transactions'}
    </button>
  </ParsingCard>
  );
};

export default ToBeReviewedCard;

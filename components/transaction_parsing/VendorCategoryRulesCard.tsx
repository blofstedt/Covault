import React from 'react';
import { BudgetCategory } from '../../types';
import type { VendorOverride } from './useVendorOverrides';

interface VendorCategoryRulesCardProps {
  allVendors: string[];
  vendorOverrideByName: Map<string, VendorOverride>;
  categoryNameById: Map<string, string>;
  expandedVendorCategory: string | null;
  budgets: BudgetCategory[];
  showDemoData: boolean;
  onSetExpandedVendorCategory: (vendorName: string | null) => void;
  onToggleAutoAccept: (overrideId: string, currentValue: boolean) => void;
  onSetVendorCategory: (vendorName: string, categoryId: string) => void;
  onDeleteVendorOverride: (overrideId: string) => void;
}

const VendorCategoryRulesCard: React.FC<VendorCategoryRulesCardProps> = ({
  allVendors,
  vendorOverrideByName,
  categoryNameById,
  expandedVendorCategory,
  budgets,
  showDemoData,
  onSetExpandedVendorCategory,
  onToggleAutoAccept,
  onSetVendorCategory,
  onDeleteVendorOverride,
}) => {
  if (allVendors.length === 0 && !showDemoData) return null;

  return (
    <div id="parsing-vendor-rules-section" className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-xl border border-violet-200 dark:border-violet-800/40 space-y-3">
      <div className="flex items-center space-x-3">
        <div className="p-2 bg-violet-50 dark:bg-violet-900/20 rounded-xl">
          <svg className="w-5 h-5 text-violet-600 dark:text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
          </svg>
        </div>
        <div className="flex-1">
          <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            Vendor Category Rules
          </h3>
          <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
            Default budget categories for each vendor
          </p>
        </div>
        <span className="text-[10px] font-black bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 px-2.5 py-1 rounded-full">
          {showDemoData && allVendors.length === 0 ? 2 : allVendors.length}
        </span>
      </div>

      <div className="space-y-2">
        {allVendors.map((vendorName) => {
          const vo = vendorOverrideByName.get(vendorName.toLowerCase());
          const hasCategory = vo && vo.category_id;
          const isExpanded = expandedVendorCategory === vendorName;

          return (
            <div key={vendorName} className="bg-violet-50 dark:bg-violet-900/10 rounded-2xl border border-violet-100 dark:border-violet-800/30 overflow-hidden">
              <div
                role="button"
                tabIndex={0}
                onClick={() => onSetExpandedVendorCategory(isExpanded ? null : vendorName)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSetExpandedVendorCategory(isExpanded ? null : vendorName); } }}
                className="w-full flex items-center justify-between p-3 transition-all active:scale-[0.99] cursor-pointer"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[10px] font-bold text-slate-700 dark:text-slate-200 truncate">
                    {vendorName}
                  </span>
                  <svg className="w-3 h-3 text-slate-300 dark:text-slate-600 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                  <span className={`text-[10px] font-bold truncate ${
                    hasCategory
                      ? 'text-violet-600 dark:text-violet-400'
                      : 'text-slate-400 dark:text-slate-500 italic'
                  }`}>
                    {hasCategory ? (vo?.category_name || categoryNameById.get(vo?.category_id ?? '') || 'Unknown') : 'None Selected'}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  {vo && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleAutoAccept(vo.id, vo.auto_accept);
                      }}
                      className={`flex items-center gap-1 px-2 py-1 rounded-full text-[8px] font-black uppercase tracking-wider transition-all active:scale-95 ${
                        vo.auto_accept
                          ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/40'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700'
                      }`}
                      title={vo.auto_accept ? 'Auto-accept is on' : 'Auto-accept is off'}
                    >
                      <div className={`w-6 h-3.5 rounded-full relative transition-colors ${vo.auto_accept ? 'bg-emerald-400 dark:bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
                        <div className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow-sm transition-all ${vo.auto_accept ? 'left-3' : 'left-0.5'}`} />
                      </div>
                      <span>Auto Approve</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Expanded: category picker */}
              {isExpanded && (
                <div className="px-3 pb-3 space-y-2 border-t border-violet-100 dark:border-violet-800/30 pt-2">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Select Default Category
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {budgets.map((b) => (
                      <button
                        key={b.id}
                        onClick={() => onSetVendorCategory(vendorName, b.id)}
                        className={`px-3 py-1.5 text-[10px] font-bold rounded-full border transition-all active:scale-95 ${
                          vo?.category_id === b.id
                            ? 'bg-violet-500 text-white border-violet-600'
                            : 'bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-800/40 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/40'
                        }`}
                      >
                        {b.name}
                      </button>
                    ))}
                  </div>
                  {vo && (
                    <button
                      onClick={() => onDeleteVendorOverride(vo.id)}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-2 mt-2 text-[10px] font-bold rounded-xl border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/40 transition-all active:scale-95"
                      title="Delete this vendor category rule"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6" />
                      </svg>
                      Delete Rule
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {allVendors.length === 0 && showDemoData && (
          <>
            <div className="bg-violet-50 dark:bg-violet-900/10 rounded-2xl border border-violet-100 dark:border-violet-800/30 overflow-hidden">
              <div className="w-full flex items-center justify-between p-3">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[10px] font-bold text-slate-700 dark:text-slate-200 truncate">Coffee Shop</span>
                  <svg className="w-3 h-3 text-slate-300 dark:text-slate-600 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="9 18 15 12 9 6" /></svg>
                  <span className="text-[10px] font-bold truncate text-violet-600 dark:text-violet-400">Leisure</span>
                </div>
              </div>
            </div>
            <div className="bg-violet-50 dark:bg-violet-900/10 rounded-2xl border border-violet-100 dark:border-violet-800/30 overflow-hidden">
              <div className="w-full flex items-center justify-between p-3">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[10px] font-bold text-slate-700 dark:text-slate-200 truncate">Grocery Mart</span>
                  <svg className="w-3 h-3 text-slate-300 dark:text-slate-600 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="9 18 15 12 9 6" /></svg>
                  <span className="text-[10px] font-bold truncate text-violet-600 dark:text-violet-400">Groceries</span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default VendorCategoryRulesCard;

import React, { useState, useCallback } from 'react';
import ParsingCard from '../ui/ParsingCard';
import { useNotificationRules } from './useNotificationRules';
import type { VendorOverride, MatchType } from './useVendorOverrides';
import { toVendorKey } from '../../lib/deviceTransactionParser';
import { BudgetCategory } from '../../types';

interface LearnedRulesCardProps {
  userId?: string;
  vendorOverrides: VendorOverride[];
  allVendors?: string[];
  vendorOverrideByName?: Map<string, VendorOverride>;
  categoryNameById?: Map<string, string>;
  budgets?: BudgetCategory[];
  onDeleteVendorOverride: (overrideId: string) => void;
  onSetVendorCategory?: (vendorName: string, categoryId: string) => void;
  onSetProperName?: (vendorName: string, properName: string) => void;
  onSetMatchType?: (vendorName: string, matchType: MatchType) => void;
  onSetExpandedVendorCategory?: (vendorName: string | null) => void;
  expandedVendorCategory?: string | null;
  isExpanded?: boolean;
  onToggleExpanded?: () => void;
}

const LearnedRulesCard: React.FC<LearnedRulesCardProps> = ({
  userId,
  vendorOverrides,
  allVendors = [],
  vendorOverrideByName = new Map(),
  categoryNameById = new Map(),
  budgets = [],
  onDeleteVendorOverride,
  onSetVendorCategory,
  onSetProperName,
  onSetMatchType,
  onSetExpandedVendorCategory,
  expandedVendorCategory,
  isExpanded = true,
  onToggleExpanded,
}) => {
  const { rules, loading, remove } = useNotificationRules({ userId });
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [editingProperName, setEditingProperName] = useState<string | null>(null);
  const [properNameDraft, setProperNameDraft] = useState('');

  const totalRules = vendorOverrides.length + rules.length;

  // Combine vendor overrides with all vendors for the management UI
  const displayVendors = allVendors.length > 0 ? allVendors : vendorOverrides.map(vo => vo.proper_name);

  const fmtUpdated = (iso?: string | null): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const diffMs = Date.now() - d.getTime();
    const day = 24 * 60 * 60 * 1000;
    if (diffMs < day) return 'today';
    if (diffMs < 2 * day) return 'yesterday';
    if (diffMs < 7 * day) return `${Math.floor(diffMs / day)}d ago`;
    if (diffMs < 30 * day) return `${Math.floor(diffMs / (7 * day))}w ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const handleRemoveRule = useCallback(
    async (ruleId: string) => {
      setRemovingId(ruleId);
      try {
        await remove(ruleId);
      } finally {
        setRemovingId(null);
      }
    },
    [remove],
  );

  const matchTypeStyles: Record<MatchType, string> = {
    exact: 'bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700/50',
    prefix: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-700/50',
    contains: 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-700/50',
  };

  return (
    <ParsingCard
      id="parsing-learned-rules"
      colorScheme="violet"
      icon={<path d="M12 2a3 3 0 00-3 3v1H7a3 3 0 00-3 3v3a3 3 0 003 3h10a3 3 0 003-3V9a3 3 0 00-3-3h-2V5a3 3 0 00-3-3zm0 2a1 1 0 011 1v1h-2V5a1 1 0 011-1z" />}
      title="Learned Rules"
      subtitle="Manage vendor mappings and auto-categorization"
      count={totalRules}
      collapsible
      isExpanded={isExpanded}
      onToggleExpanded={onToggleExpanded}
    >
      {isExpanded && (
        <div className="space-y-3">
          {/* Vendor Mapping Section */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <p className="text-[10px] font-bold tracking-wide text-slate-400 dark:text-slate-500 uppercase">
                Vendor Mappings
              </p>
              <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800/60 px-1.5 py-0.5 rounded-full">
                {vendorOverrides.length}
              </span>
            </div>

            <div className="space-y-1.5 mb-3">
              {displayVendors.map((vendorName) => {
                const vo = vendorOverrideByName.get(toVendorKey(vendorName));
                const hasCategory = vo && vo.category_id;
                const isVendorExpanded = expandedVendorCategory === vendorName;
                const displayName = vo?.proper_name || vendorName;

                return (
                  <div key={vendorName} className="bg-white/60 dark:bg-violet-900/10 backdrop-blur-sm rounded-2xl border border-violet-100 dark:border-violet-800/30 ring-1 ring-inset ring-white/10 dark:ring-white/[0.04] overflow-hidden">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => onSetExpandedVendorCategory?.(isVendorExpanded ? null : vendorName)}
                      className="w-full flex items-center justify-between p-3 transition-all duration-200 active:scale-[0.99] cursor-pointer"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">
                          {displayName}
                          {vo?.proper_name && vo.proper_name !== vendorName && (
                            <span className="text-slate-400 dark:text-slate-500 font-normal ml-1">({vendorName})</span>
                          )}
                        </span>
                        <span className={`text-xs font-bold truncate ${
                          hasCategory
                            ? 'text-violet-600 dark:text-violet-400'
                            : 'text-slate-400 dark:text-slate-500 italic'
                        }`}>
                          {hasCategory ? (vo?.category_name || categoryNameById.get(vo?.category_id ?? '') || 'Unknown') : 'None Selected'}
                        </span>
                      </div>
                      <svg className={`w-3 h-3 text-slate-300 dark:text-slate-600 shrink-0 transition-transform ${isVendorExpanded ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </div>

                    {isVendorExpanded && (
                      <div className="px-3 pb-3 space-y-2 border-t border-violet-100 dark:border-violet-800/30 pt-2">
                        {/* Category picker */}
                        <div>
                          <p className="text-[11px] font-semibold tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                            Category
                          </p>
                          <div className="grid grid-cols-2 gap-1.5">
                            {budgets.map((b) => (
                              <button
                                key={b.id}
                                type="button"
                                onClick={() => onSetVendorCategory?.(vendorName, b.id)}
                                className={`px-2 py-1.5 text-[10px] font-bold rounded-lg border transition-all duration-200 active:scale-[0.97] ${
                                  vo?.category_id === b.id
                                    ? 'bg-violet-500 text-white border-violet-600'
                                    : 'bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-800/40 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/40'
                                }`}
                              >
                                {b.name}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Proper name editor */}
                        {vo && (
                          <div>
                            <p className="text-[11px] font-semibold tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                              Display Name
                            </p>
                            {editingProperName === vendorName ? (
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="text"
                                  value={properNameDraft}
                                  onChange={(e) => setProperNameDraft(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      onSetProperName?.(vendorName, properNameDraft);
                                      setEditingProperName(null);
                                    } else if (e.key === 'Escape') {
                                      setEditingProperName(null);
                                    }
                                  }}
                                  placeholder={vendorName}
                                  className="flex-1 px-2 py-1 text-[10px] rounded-lg border border-violet-200 dark:border-violet-800/40 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-violet-400"
                                  autoFocus
                                />
                                <button
                                  onClick={() => {
                                    onSetProperName?.(vendorName, properNameDraft);
                                    setEditingProperName(null);
                                  }}
                                  className="px-2 py-1 text-[11px] font-bold rounded-lg bg-violet-500 text-white hover:bg-violet-600 transition-all duration-200 active:scale-[0.97]"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={() => setEditingProperName(null)}
                                  className="px-2 py-1 text-[11px] font-bold rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 transition-all duration-200 active:scale-[0.97]"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => {
                                  setProperNameDraft(vo.proper_name ?? '');
                                  setEditingProperName(vendorName);
                                }}
                                className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-lg border border-dashed border-violet-200 dark:border-violet-800/40 text-slate-600 dark:text-slate-300 hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-all duration-200 active:scale-[0.97]"
                              >
                                <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                                </svg>
                                <span className="truncate">
                                  {vo.proper_name ? vo.proper_name : `Set preferred name for "${vendorName}"`}
                                </span>
                              </button>
                            )}
                          </div>
                        )}

                        {/* Match type picker */}
                        {vo && onSetMatchType && (
                          <div>
                            <p className="text-[11px] font-semibold tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                              Match incoming notifications
                            </p>
                            <div className="grid grid-cols-3 gap-1.5">
                              {(['exact', 'prefix', 'contains'] as const).map((mt) => (
                                <button
                                  key={mt}
                                  type="button"
                                  onClick={() => onSetMatchType(vendorName, mt)}
                                  title={
                                    mt === 'exact'
                                      ? 'Only this exact vendor name'
                                      : mt === 'prefix'
                                      ? 'Vendor names starting with this'
                                      : 'Vendor names containing this'
                                  }
                                  className={`px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide rounded-lg border transition-all duration-200 active:scale-[0.97] ${
                                    (vo.match_type || 'exact') === mt
                                      ? 'bg-violet-500 text-white border-violet-600'
                                      : 'bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-800/40 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/40'
                                  }`}
                                >
                                  {mt}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Delete button */}
                        {vo && (
                          <button
                            onClick={() => onDeleteVendorOverride(vo.id)}
                            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] font-bold rounded-lg border border-rose-200 dark:border-rose-800/40 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-all duration-200 active:scale-[0.97]"
                          >
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                              <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            Remove Rule
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Skip Patterns (Notification Rules) */}
          {rules.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <p className="text-[10px] font-bold tracking-wide text-slate-400 dark:text-slate-500 uppercase">
                  Skip Patterns
                </p>
                <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800/60 px-1.5 py-0.5 rounded-full">
                  {rules.length}
                </span>
              </div>
              <div className="space-y-1.5">
                {rules.map((rule) => (
                  <div
                    key={rule.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-white/60 dark:bg-violet-900/10 backdrop-blur-sm border border-violet-100 dark:border-violet-800/30"
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200 truncate">
                        {rule.pattern}
                      </p>
                      <span className={`text-[8px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border shrink-0 ${matchTypeStyles[rule.pattern_type as MatchType] || matchTypeStyles.exact}`}>
                        {rule.pattern_type}
                      </span>
                      {rule.use_count !== undefined && (
                        <span className="text-[9px] font-semibold text-violet-500 dark:text-violet-400">
                          {rule.use_count} uses
                        </span>
                      )}
                      {rule.updated_at && (
                        <span className="text-[9px] text-slate-400 dark:text-slate-500">
                          {fmtUpdated(rule.updated_at)}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemoveRule(rule.id)}
                      disabled={removingId === rule.id}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-all duration-200 active:scale-[0.97] disabled:opacity-50"
                      aria-label="Remove rule"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                        <path d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </ParsingCard>
  );
};

export default LearnedRulesCard;
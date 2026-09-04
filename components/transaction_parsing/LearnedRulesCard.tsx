import React, { useState, useCallback, useMemo } from 'react';
import ParsingCard from '../ui/ParsingCard';
import type { NotificationRule } from '../../lib/notificationRules';
import type { VendorOverride, MatchType } from './useVendorOverrides';
import { toVendorKey } from '../../lib/deviceTransactionParser';
import { formatCurrency } from '../../lib/formatCurrency';
import { BudgetCategory, Transaction } from '../../types';

// --- Static Definitions Moved Outside Component to Prevent Re-allocation ---
const matchTypeStyles: Record<MatchType, string> = {
  exact: 'bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700/50',
  prefix: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-700/50',
  contains: 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-700/50',
};

const categoryColorMap: Record<string, string> = {
  'Groceries': 'text-emerald-600 dark:text-emerald-400',
  'Gas': 'text-amber-600 dark:text-amber-400',
  'Dining': 'text-rose-600 dark:text-rose-400',
  'Shopping': 'text-violet-600 dark:text-violet-400',
  'Entertainment': 'text-pink-600 dark:text-pink-400',
  'Bills': 'text-blue-600 dark:text-blue-400',
  'Transport': 'text-cyan-600 dark:text-cyan-400',
  'Health': 'text-teal-600 dark:text-teal-400',
  'Other': 'text-slate-600 dark:text-slate-400',
};


interface LearnedRule {
  properName: string;
  categoryId: string;
  categoryName: string;
  patterns: VendorOverride[];
  transactions: Transaction[];
}

// Stable identities for omitted props. A fresh `[]` / `new Map()` per render
// would invalidate the memos below on every single render.
const EMPTY_RULES: NotificationRule[] = [];
const EMPTY_BUDGETS: BudgetCategory[] = [];
const EMPTY_TRANSACTIONS: Transaction[] = [];
const EMPTY_CATEGORY_NAMES = new Map<string, string>();

interface LearnedRulesCardProps {
  vendorOverrides: VendorOverride[];
  /** Skip-pattern rules, owned by TransactionParsing. Passed in rather than
   *  fetched here so the two consumers share one fetch and one copy of the
   *  state — previously each mounted its own hook, so a rule created from the
   *  "not a transaction" flow never appeared in this list. */
  rules?: NotificationRule[];
  onRemoveRule?: (ruleId: string) => Promise<boolean>;
  categoryNameById?: Map<string, string>;
  budgets?: BudgetCategory[];
  allTransactions?: Transaction[];
  onDeleteVendorOverride: (overrideId: string) => void;
  onSetVendorCategory?: (vendorName: string, categoryId: string) => void;
  onSetProperName?: (vendorName: string, properName: string) => void;
  onSetExpandedVendorCategory?: (vendorName: string | null) => void;
  expandedVendorCategory?: string | null;
  isExpanded?: boolean;
  onToggleExpanded?: () => void;
}

const LearnedRulesCard: React.FC<LearnedRulesCardProps> = ({
  vendorOverrides,
  rules = EMPTY_RULES,
  onRemoveRule,
  categoryNameById = EMPTY_CATEGORY_NAMES,
  budgets = EMPTY_BUDGETS,
  allTransactions = EMPTY_TRANSACTIONS,
  onDeleteVendorOverride,
  onSetVendorCategory,
  onSetProperName,
  onSetExpandedVendorCategory,
  expandedVendorCategory,
  isExpanded = true,
  onToggleExpanded,
}) => {
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [editingProperName, setEditingProperName] = useState<string | null>(null);
  const [properNameDraft, setProperNameDraft] = useState('');
  const [mergingRule, setMergingRule] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);

  // Group vendor overrides into learned rules by (proper_name, category_id)
  const learnedRules = useMemo((): LearnedRule[] => {
    const groups = new Map<string, LearnedRule>();

    for (const vo of vendorOverrides) {
      const key = `${vo.proper_name}::${vo.category_id || 'uncategorized'}`;
      if (!groups.has(key)) {
        groups.set(key, {
          properName: vo.proper_name,
          categoryId: vo.category_id || '',
          categoryName: vo.category_name || categoryNameById.get(vo.category_id || '') || vo.category_id || 'Uncategorized',
          patterns: [],
          transactions: [],
        });
      }
      groups.get(key)!.patterns.push(vo);
    }

    // Performance Optimization: Pre-compute transaction keys once
    const txCache = allTransactions.map(tx => ({
      tx,
      txKey: toVendorKey(tx.vendor)
    }));

    // Attach transactions that match each rule's patterns
    for (const rule of groups.values()) {
      // Performance Optimization: Pre-compute pattern keys once per rule
      const patternCache = rule.patterns.map(pattern => ({
        matchType: pattern.match_type || 'exact',
        patternKey: toVendorKey(pattern.match_key || pattern.proper_name)
      }));

      for (const { tx, txKey } of txCache) {
        for (const { matchType, patternKey } of patternCache) {
          let matches = false;
          if (matchType === 'exact') {
            matches = txKey === patternKey;
          } else if (matchType === 'prefix') {
            matches = txKey.startsWith(patternKey);
          } else if (matchType === 'contains') {
            matches = txKey.includes(patternKey);
          }

          if (matches) {
            rule.transactions.push(tx);
            break;
          }
        }
      }
    }

    return Array.from(groups.values()).sort((a, b) => a.properName.localeCompare(b.properName));
  }, [vendorOverrides, allTransactions, categoryNameById]);

  const totalRules = learnedRules.length + rules.length;

  const handleRemoveRule = useCallback(
    async (ruleId: string) => {
      setRemovingId(ruleId);
      try {
        await onRemoveRule?.(ruleId);
      } finally {
        setRemovingId(null);
      }
    },
    [onRemoveRule],
  );

  const handleMerge = useCallback((ruleKey: string) => {
    setMergingRule(ruleKey);
    setMergeTarget(null);
  }, []);

  const confirmMerge = useCallback(() => {
    if (!mergingRule || !mergeTarget) return;
    const sourceRule = learnedRules.find(r => `${r.properName}::${r.categoryId}` === mergingRule);
    const targetRule = learnedRules.find(r => `${r.properName}::${r.categoryId}` === mergeTarget);
    if (!sourceRule || !targetRule) return;

    // Move all patterns from source to target by updating their proper_name and category_id
    for (const pattern of sourceRule.patterns) {
      onSetProperName?.(pattern.proper_name, targetRule.properName);
      if (targetRule.categoryId) {
        onSetVendorCategory?.(pattern.proper_name, targetRule.categoryId);
      }
    }

    setMergingRule(null);
    setMergeTarget(null);
  }, [mergingRule, mergeTarget, learnedRules, onSetProperName, onSetVendorCategory]);

  return (
    <ParsingCard
      id="parsing-learned-rules"
      colorScheme="violet"
      // A checked list, not the old robot head: this card is a list of
      // decisions the user has already signed off — "this vendor, that
      // category" — and the head read as a cloud at 20px, filled shape drawn
      // with a stroke-only pen.
      icon={
        <>
          <polyline points="3 6 4.5 7.5 7.5 4.5" />
          <polyline points="3 12 4.5 13.5 7.5 10.5" />
          <polyline points="3 18 4.5 19.5 7.5 16.5" />
          <line x1="11" y1="6" x2="21" y2="6" />
          <line x1="11" y1="12" x2="21" y2="12" />
          <line x1="11" y1="18" x2="21" y2="18" />
        </>
      }
      title="Existing Rules"
      subtitle="Vendor and category pairs, plus alerts it skips"
      count={totalRules}
      collapsible
      isExpanded={isExpanded}
      onToggleExpanded={onToggleExpanded}
    >
      {isExpanded && (
        <div className="space-y-3">
          {/* Learned Rules List */}
          {learnedRules.length === 0 ? (
            <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-4">
              No rules yet. Every time you categorize a caught transaction, that vendor and category become a rule.
            </p>
          ) : (
            <div className="space-y-2">
              {learnedRules.map((rule) => {
                const ruleKey = `${rule.properName}::${rule.categoryId}`;
                const isExpanded = expandedVendorCategory === ruleKey;
                const categoryColor = categoryColorMap[rule.categoryName] || 'text-violet-600 dark:text-violet-400';

                return (
                  <div key={ruleKey} className="bg-white/60 dark:bg-violet-900/10 backdrop-blur-sm rounded-2xl border border-violet-100 dark:border-violet-800/30 ring-1 ring-inset ring-white/10 dark:ring-white/[0.04] overflow-hidden">
                    {/* Rule Header */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => onSetExpandedVendorCategory?.(isExpanded ? null : ruleKey)}
                      className="w-full flex items-center justify-between p-3 transition-all duration-200 active:scale-[0.99] cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">
                          {rule.properName}
                        </span>
                        <span className="text-[11px]">→</span>
                        <span className={`text-xs font-bold truncate ${categoryColor}`}>
                          {rule.categoryName}
                        </span>
                        <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800/60 px-1.5 py-0.5 rounded-full shrink-0">
                          {rule.transactions.length} tx
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {mergingRule === ruleKey && (
                          <span className="text-[11px] font-bold text-amber-500">merging</span>
                        )}
                        <svg className={`w-3 h-3 text-slate-300 dark:text-slate-600 transition-transform ${isExpanded ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </div>
                    </div>

                    {/* Expanded Content */}
                    {isExpanded && (
                      <div className="px-3 pb-3 space-y-3 border-t border-violet-100 dark:border-violet-800/30 pt-2">
                        {/* Match Patterns */}
                        <div>
                          <p className="text-[11px] font-bold tracking-wide text-slate-400 dark:text-slate-500 uppercase mb-1.5">
                            Match Patterns ({rule.patterns.length})
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {rule.patterns.map((pattern) => (
                              <div key={pattern.id} className="flex items-center gap-1">
                                <span className={`text-[11px] font-bold px-2 py-1 rounded-lg border ${matchTypeStyles[pattern.match_type || 'exact']}`}>
                                  {pattern.match_type || 'exact'}: {pattern.match_key || pattern.proper_name}
                                </span>
                                <button
                                  onClick={() => onDeleteVendorOverride(pattern.id)}
                                  className="p-0.5 rounded text-slate-400 hover:text-rose-500 transition-colors"
                                  title="Remove pattern"
                                >
                                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                                    <path d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Transactions under this rule */}
                        {rule.transactions.length > 0 && (
                          <div>
                            <p className="text-[11px] font-bold tracking-wide text-slate-400 dark:text-slate-500 uppercase mb-1.5">
                              Transactions ({rule.transactions.length})
                            </p>
                            <div className="space-y-1 max-h-40 overflow-y-auto no-scrollbar">
                              {rule.transactions.map((tx) => (
                                <div key={tx.id} className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-violet-50/50 dark:bg-violet-900/20">
                                  <span className="text-[11px] text-slate-600 dark:text-slate-300 truncate flex-1">{tx.vendor}</span>
                                  <span className="text-[11px] font-mono font-semibold text-slate-700 dark:text-slate-200 shrink-0">
                                    {formatCurrency(tx.amount)}
                                  </span>
                                  <span className="text-[11px] text-slate-400 dark:text-slate-500 ml-2 shrink-0">
                                    {new Date(tx.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {/* Change Category */}
                          <div className="relative group">
                            <button className="px-2 py-1 text-[11px] font-bold rounded-lg bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800/40 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-all">
                              Change Category
                            </button>
                            <div className="absolute bottom-full left-0 mb-1 hidden group-hover:grid grid-cols-2 gap-1 p-2 bg-white dark:bg-slate-800 rounded-xl border border-violet-200 dark:border-violet-800/40 shadow-lg z-20 min-w-[180px]">
                              {budgets.map((b) => (
                                <button
                                  key={b.id}
                                  onClick={() => {
                                    for (const p of rule.patterns) {
                                      onSetVendorCategory?.(p.proper_name, b.id);
                                    }
                                  }}
                                  className="px-2 py-1 text-[11px] font-bold rounded-lg bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-all text-left"
                                >
                                  {b.name}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Edit Name */}
                          {editingProperName === ruleKey ? (
                            <div className="flex items-center gap-1 flex-1">
                              <input
                                type="text"
                                value={properNameDraft}
                                onChange={(e) => setProperNameDraft(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    for (const p of rule.patterns) {
                                      onSetProperName?.(p.proper_name, properNameDraft);
                                    }
                                    setEditingProperName(null);
                                  } else if (e.key === 'Escape') {
                                    setEditingProperName(null);
                                  }
                                }}
                                className="flex-1 px-2 py-1 text-[11px] rounded-lg border border-violet-200 dark:border-violet-800/40 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-violet-400"
                                autoFocus
                              />
                              <button
                                onClick={() => {
                                  for (const p of rule.patterns) {
                                    onSetProperName?.(p.proper_name, properNameDraft);
                                  }
                                  setEditingProperName(null);
                                }}
                                className="px-2 py-1 text-[11px] font-bold rounded-lg bg-violet-500 text-white"
                              >
                                Save
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                setProperNameDraft(rule.properName);
                                setEditingProperName(ruleKey);
                              }}
                              className="px-2 py-1 text-[11px] font-bold rounded-lg bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800/40 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-all"
                            >
                              Edit Name
                            </button>
                          )}

                          {/* Merge */}
                          {mergingRule === ruleKey ? (
                            <div className="flex items-center gap-1">
                              <select
                                value={mergeTarget || ''}
                                onChange={(e) => setMergeTarget(e.target.value || null)}
                                className="text-[11px] rounded-lg border border-violet-200 dark:border-violet-800/40 bg-white dark:bg-slate-800 px-2 py-1"
                              >
                                <option value="">Select target...</option>
                                {learnedRules
                                  .filter(r => `${r.properName}::${r.categoryId}` !== ruleKey)
                                  .map(r => (
                                    <option key={`${r.properName}::${r.categoryId}`} value={`${r.properName}::${r.categoryId}`}>
                                      {r.properName} → {r.categoryName}
                                    </option>
                                  ))}
                              </select>
                              <button
                                onClick={confirmMerge}
                                disabled={!mergeTarget}
                                className="px-2 py-1 text-[11px] font-bold rounded-lg bg-amber-500 text-white disabled:opacity-50"
                              >
                                Merge
                              </button>
                              <button
                                onClick={() => { setMergingRule(null); setMergeTarget(null); }}
                                className="px-2 py-1 text-[11px] font-bold rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => handleMerge(ruleKey)}
                              className="px-2 py-1 text-[11px] font-bold rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-all"
                            >
                              Merge
                            </button>
                          )}

                          {/* Delete all patterns in this rule */}
                          <button
                            onClick={() => {
                              for (const p of rule.patterns) {
                                onDeleteVendorOverride(p.id);
                              }
                            }}
                            className="px-2 py-1 text-[11px] font-bold rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800/40 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-all"
                          >
                            Delete Rule
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Skip Patterns (Notification Rules) */}
          {rules.length > 0 && (
            <div className="pt-2 border-t border-violet-100 dark:border-violet-800/30">
              <div className="flex items-center gap-1.5 mb-1.5">
                <p className="text-[11px] font-bold tracking-wide text-slate-400 dark:text-slate-500 uppercase">
                  Skip Patterns
                </p>
                <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800/60 px-1.5 py-0.5 rounded-full">
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
                      <span className={`text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border shrink-0 ${matchTypeStyles[rule.pattern_type as MatchType] || matchTypeStyles.exact}`}>
                        {rule.pattern_type}
                      </span>
                      {rule.use_count !== undefined && (
                        <span className="text-[11px] font-semibold text-violet-500 dark:text-violet-400">
                          {rule.use_count} uses
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

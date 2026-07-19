import React, { useState, useCallback } from 'react';
import ParsingCard from '../ui/ParsingCard';
import { EmptyState } from '../shared';
import { useNotificationRules } from './useNotificationRules';
import type { VendorOverride } from './useVendorOverrides';
import type { MatchType } from './useVendorOverrides';

interface LearnedRulesCardProps {
  userId?: string;
  /** Vendor overrides currently loaded (Vendor Category Rules card passes these). */
  vendorOverrides: VendorOverride[];
  /** Delete a vendor override. */
  onDeleteVendorOverride: (overrideId: string) => void;
}

/**
 * "Learned Rules" card on the <> page. Surfaces two types of
 * user-trained rules:
 *   1. Vendor corrections (the existing `overrides` table) with their
 *      match_type (exact/prefix/contains), use count (we approximate
 *      from `updated_at` recency since the overrides table doesn't
 *      track use_count), and quick-delete affordance.
 *   2. Skip patterns (the new `notification_rules` table) with their
 *      pattern_type (exact/contains), use count from the DB, and
 *      quick-delete.
 *
 * This is the user's window into "what has Covault learned from me?"
 * — they can audit, prune, or disable rules here.
 */
const LearnedRulesCard: React.FC<LearnedRulesCardProps> = ({
  userId,
  vendorOverrides,
  onDeleteVendorOverride,
}) => {
  const { rules, loading, remove } = useNotificationRules({ userId });
  const [expanded, setExpanded] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const totalRules = vendorOverrides.length + rules.length;
  if (totalRules === 0) return null;

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
      subtitle="What Covault has learned from your corrections"
      count={totalRules}
      headerAction={
        <button
          onClick={() => setExpanded((v) => !v)}
          className="p-1.5 rounded-lg hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          <svg
            className={`w-4 h-4 text-slate-400 dark:text-slate-500 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </button>
      }
    >
      {expanded && (
        <div className="space-y-3">
          {/* ── Vendor corrections ── */}
          {vendorOverrides.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <p className="text-[10px] font-bold tracking-wide text-slate-400 dark:text-slate-500 uppercase">
                  Vendor corrections
                </p>
                <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800/60 px-1.5 py-0.5 rounded-full">
                  {vendorOverrides.length}
                </span>
              </div>
              <div className="space-y-1.5">
                {vendorOverrides.map((vo) => (
                  <div
                    key={vo.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-white/60 dark:bg-violet-900/10 backdrop-blur-sm border border-violet-100 dark:border-violet-800/30"
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200 truncate">
                        {vo.proper_name}
                      </p>
                      {vo.match_type && (
                        <span className={`text-[8px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border shrink-0 ${matchTypeStyles[vo.match_type]}`}>
                          {vo.match_type}
                        </span>
                      )}
                      {vo.category_name && (
                        <span className="text-[9px] font-semibold text-violet-600 dark:text-violet-400 shrink-0">
                          → {vo.category_name}
                        </span>
                      )}
                      {vo.updated_at && (
                        <span className="text-[9px] text-slate-400 dark:text-slate-500 shrink-0 ml-auto">
                          {fmtUpdated(vo.updated_at)}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => onDeleteVendorOverride(vo.id)}
                      className="shrink-0 p-1 rounded-md text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-all"
                      title="Delete this rule"
                      aria-label={`Delete rule for ${vo.proper_name}`}
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Skip patterns ── */}
          {rules.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <p className="text-[10px] font-bold tracking-wide text-slate-400 dark:text-slate-500 uppercase">
                  Skip patterns
                </p>
                <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800/60 px-1.5 py-0.5 rounded-full">
                  {rules.length}
                </span>
              </div>
              <div className="space-y-1.5">
                {rules.map((rule) => (
                  <div
                    key={rule.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-white/60 dark:bg-amber-900/10 backdrop-blur-sm border border-amber-100 dark:border-amber-800/30"
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <span className={`shrink-0 text-[8px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${
                        rule.pattern_type === 'exact'
                          ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700/50'
                          : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-700/50'
                      }`}>
                        {rule.pattern_type}
                      </span>
                      <p className="text-[10px] font-mono text-slate-700 dark:text-slate-200 truncate" title={rule.pattern}>
                        {rule.pattern}
                      </p>
                      {rule.use_count > 0 && (
                        <span className="text-[9px] text-slate-400 dark:text-slate-500 shrink-0 ml-auto">
                          used {rule.use_count}×{rule.last_used_at ? ` · ${fmtUpdated(rule.last_used_at)}` : ''}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemoveRule(rule.id)}
                      disabled={removingId === rule.id}
                      className="shrink-0 p-1 rounded-md text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-all disabled:opacity-50"
                      title="Delete this rule"
                      aria-label={`Delete skip pattern ${rule.pattern.slice(0, 30)}`}
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {loading && (
            <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center py-2">Loading…</p>
          )}
        </div>
      )}
    </ParsingCard>
  );
};

export default LearnedRulesCard;

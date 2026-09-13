import React from 'react';
import ParsingCard from '../ui/ParsingCard';
import {
  captureHealth,
  agoLabel,
  heardFrom,
  type CaptureHealthInput,
} from '../../lib/captureHealth';
import { captureOutcomeAppName } from '../../lib/captureOutcome';

interface CaptureHealthCardProps extends CaptureHealthInput {
  isExpanded?: boolean;
  onToggleExpanded?: () => void;
  /** Opens Android's notification-access page. */
  onFixAccess?: () => void;
  /** Opens Covault's own notification settings. */
  onFixNotifications?: () => void;
  /** Opens the capture-sources picker in settings. */
  onFixSources?: () => void;
}

/**
 * Why a purchase did or did not turn up.
 *
 * On the Review screen rather than buried in settings, because this is the
 * screen somebody is looking at when they ask the question. It answers it with
 * things the phone already knows and the app was keeping to itself: whether
 * the four links in the chain are intact, when each bank last reached us, and
 * what happened to the last few alerts that were not captured.
 *
 * Collapsed by default and quiet when everything is fine — a diagnostic that
 * shouts on a working install is one people learn to scroll past, and then it
 * is not there on the day it matters.
 */
const CaptureHealthCard: React.FC<CaptureHealthCardProps> = ({
  isExpanded = false,
  onToggleExpanded,
  onFixAccess,
  onFixNotifications,
  onFixSources,
  ...input
}) => {
  const health = captureHealth(input);
  const banks = heardFrom(input.lastSeen).slice(0, 5);
  const now = input.now ?? Date.now();

  const fixFor = (key?: 'access' | 'notifications' | 'sources') => {
    if (key === 'access') return onFixAccess;
    if (key === 'notifications') return onFixNotifications;
    if (key === 'sources') return onFixSources;
    return undefined;
  };

  return (
    <ParsingCard
      colorScheme={health.level === 'ok' ? 'emerald' : health.level === 'off' ? 'slate' : 'amber'}
      icon={
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
      }
      title="Capture health"
      subtitle={health.headline}
      collapsible
      isExpanded={isExpanded}
      onToggleExpanded={onToggleExpanded}
    >
      <div className="space-y-3">
        {/* ── The chain, in the order it breaks ── */}
        <div className="space-y-1">
          {health.checks.map((check) => {
            const fix = fixFor(check.fix);
            return (
              <div
                key={check.key}
                className="flex items-start gap-2 px-3 py-2 rounded-xl bg-white/60 dark:bg-slate-900/30"
              >
                <span
                  className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${
                    check.ok ? 'bg-emerald-500' : 'bg-amber-500'
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200">
                    {check.label}
                  </p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug mt-0.5">
                    {check.detail}
                  </p>
                  {fix && (
                    <button
                      type="button"
                      onClick={fix}
                      className="mt-1.5 inline-flex items-center px-2 py-1 rounded-lg bg-amber-100 dark:bg-amber-900/40 border border-amber-200 dark:border-amber-800/40 text-[10px] font-bold text-amber-800 dark:text-amber-200 active:scale-[0.97] transition-transform"
                    >
                      Fix this →
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Who has been talking to us ── */}
        {banks.length > 0 && (
          <div>
            <p className="text-[11px] font-bold tracking-wide text-slate-400 dark:text-slate-500 uppercase mb-1.5">
              Last heard from
            </p>
            <div className="space-y-1">
              {banks.map((bank) => {
                const quiet = input.silent.includes(bank.app);
                return (
                  <div
                    key={bank.app}
                    className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-white/60 dark:bg-slate-900/30"
                  >
                    <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 truncate">
                      {captureOutcomeAppName(bank.app)}
                    </span>
                    <span
                      className={`text-[10px] font-semibold shrink-0 ${
                        quiet
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-slate-400 dark:text-slate-500'
                      }`}
                    >
                      {agoLabel(bank.at, now)}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-snug mt-1.5">
              Covault cannot read another app's notification settings, so a bank
              going quiet is a guess from silence — not something it can see.
            </p>
          </div>
        )}

        {/* ── Alerts that produced no purchase, and why ──
            The question this card exists for. Only the ones that went nowhere:
            a list of successes is a list nobody reads. */}
        {health.uncaptured.length > 0 && (
          <div>
            <p className="text-[11px] font-bold tracking-wide text-slate-400 dark:text-slate-500 uppercase mb-1.5">
              Alerts that became nothing
            </p>
            <div className="space-y-1">
              {health.uncaptured.slice(0, 5).map(({ entry, reason, fault }) => (
                <div
                  key={`${entry.at}-${entry.app}-${entry.outcome}`}
                  className={`px-3 py-2 rounded-xl ${
                    fault
                      ? 'bg-amber-50/70 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40'
                      : 'bg-white/60 dark:bg-slate-900/30'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 truncate">
                      {captureOutcomeAppName(entry.app)}
                      {entry.amount !== null && ` · $${entry.amount.toFixed(2)}`}
                    </span>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0">
                      {agoLabel(entry.at, now)}
                    </span>
                  </div>
                  <p className={`text-[10px] leading-snug mt-0.5 ${
                    fault
                      ? 'font-semibold text-amber-700 dark:text-amber-300'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}>
                    {reason}
                  </p>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-snug mt-1.5">
              Most of these are Covault deciding, not failing — a deposit, an ad,
              a charge that didn't go through.
            </p>
          </div>
        )}
      </div>
    </ParsingCard>
  );
};

export default CaptureHealthCard;

import React, { useState } from 'react';
import ParsingCard from '../ui/ParsingCard';
import { HOLD_SETTLE_DAYS, type PendingHold } from '../../lib/pendingHold';

interface UnsettledHoldsCardProps {
  holds: PendingHold[];
  /** Record what was actually spent. The held figure is never used. */
  onRecord: (hold: PendingHold, amount: number) => Promise<void> | void;
  /** It never went through. Forget it. */
  onDismiss: (hold: PendingHold) => void;
  isExpanded?: boolean;
  onToggleExpanded?: () => void;
}

/**
 * "Did this ever go through?"
 *
 * The one question worth asking about a hold, and the only honest thing the
 * app can do with one. A hold's real amount is unknowable — the figure the
 * bank announced is the one the hotel or the pump chose — and recording it
 * anyway puts a wrong number in a budget where nobody will think to question
 * it. Refusing in silence is no better: if the charge settled and the bank
 * said nothing the second time, that purchase is gone.
 *
 * So the amount is typed by the person who knows it, and "it never went
 * through" is an equally good answer with its own button. The held figure is
 * shown for recognition only — it is never the default in the field, because a
 * pre-filled wrong number is a number that gets accepted.
 */
const UnsettledHoldsCard: React.FC<UnsettledHoldsCardProps> = ({
  holds,
  onRecord,
  onDismiss,
  isExpanded = true,
  onToggleExpanded,
}) => {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  if (holds.length === 0) return null;

  const handleRecord = async (hold: PendingHold) => {
    const value = Number.parseFloat((drafts[hold.id] || '').replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(value) || value <= 0 || busy) return;
    setBusy(hold.id);
    try {
      await onRecord(hold, value);
    } finally {
      setBusy(null);
    }
  };

  return (
    <ParsingCard
      colorScheme="amber"
      icon={
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v4l2.5 2.5" />
        </svg>
      }
      title="Held, never settled"
      subtitle={`No charge followed in ${HOLD_SETTLE_DAYS} days`}
      count={holds.length}
      collapsible
      isExpanded={isExpanded}
      onToggleExpanded={onToggleExpanded}
    >
      <div className="space-y-2">
        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
          Your bank held money for these and never said what was finally
          charged. Covault will not guess the amount — the figure it held is
          the one the merchant picked, not the one you paid.
        </p>

        {holds.map((hold) => (
          <div
            key={hold.id}
            className="px-3 py-2.5 rounded-xl bg-white/60 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-800/30 space-y-2"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12px] font-bold text-slate-700 dark:text-slate-200 truncate">
                {hold.vendor}
              </span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0">
                {new Date(hold.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            </div>
            <p className="text-[10.5px] text-slate-500 dark:text-slate-400 leading-snug">
              {`Held $${hold.amount.toFixed(2)} — what did it actually come to?`}
            </p>

            <div className="flex gap-1.5">
              <input
                inputMode="decimal"
                placeholder="Amount"
                value={drafts[hold.id] || ''}
                onChange={(e) =>
                  setDrafts((prev) => ({ ...prev, [hold.id]: e.target.value }))
                }
                className="flex-1 min-w-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg py-2 px-3 text-[12px] font-bold text-slate-600 dark:text-slate-100 outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
              <button
                type="button"
                onClick={() => { void handleRecord(hold); }}
                disabled={busy === hold.id || !(drafts[hold.id] || '').trim()}
                className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-[11px] font-bold active:scale-[0.97] transition-all disabled:opacity-30"
              >
                {busy === hold.id ? 'Adding…' : 'Add it'}
              </button>
            </div>

            <button
              type="button"
              onClick={() => onDismiss(hold)}
              className="text-[10.5px] font-semibold text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            >
              It never went through
            </button>
          </div>
        ))}
      </div>
    </ParsingCard>
  );
};

export default UnsettledHoldsCard;

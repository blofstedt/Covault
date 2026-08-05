import React, { useCallback, useEffect, useRef, useState } from 'react';
import { formatCurrency } from '../../lib/formatCurrency';
import { hapticTap } from '../../lib/haptics';
import type { FuelHold } from '../../lib/fuelHold';
import type { SettlementCandidate } from '../../lib/fuelHoldReconcile';

/** Pump icon, shared by both panels so they read as one feature. */
const PumpIcon: React.FC = () => (
  <svg
    className="w-4 h-4 mt-0.5 shrink-0 text-amber-500 dark:text-amber-400"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 22h12V4a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v18z" />
    <path d="M6 8h6" />
    <path d="M15 9h2a2 2 0 0 1 2 2v6a2 2 0 0 0 2 2" />
  </svg>
);

const panelClass =
  'mt-3 p-3 rounded-2xl border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/20';
const primaryBtn =
  'inline-flex items-center justify-center min-h-[44px] px-4 text-[13px] font-bold rounded-2xl bg-amber-500 text-white shadow-sm shadow-amber-500/20 hover:bg-amber-600 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed';
const quietBtn =
  'inline-flex items-center justify-center min-h-[44px] px-3 text-[12px] font-bold rounded-2xl text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 active:scale-[0.98] transition-all';

interface FuelHoldPromptProps {
  hold: FuelHold;
  /** Save the real amount. Resolves once it is persisted. */
  onSubmit: (amount: number) => Promise<void> | void;
  /** Keep the placeholder for now and stop asking about this row. */
  onKeepPlaceholder: () => void;
}

/**
 * The one thing on a fuel-hold row the user can actually answer: what did you
 * pay?
 *
 * A station authorises a round figure before it lets you pump, and the settled
 * amount that follows often never arrives as its own notification. Covault
 * cannot know the real number, so rather than filing the hold and being quietly
 * wrong all month, the row shows what the bank said, carries a placeholder, and
 * asks.
 *
 * Deliberately inline rather than a modal or a sheet: this appears on rows the
 * user is already triaging, so making them open something to answer a
 * one-number question would be the slowest possible version of it.
 */
export const FuelHoldPrompt: React.FC<FuelHoldPromptProps> = ({
  hold,
  onSubmit,
  onKeepPlaceholder,
}) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const parsed = parseAmount(draft);
  const canSave = parsed != null && parsed > 0 && !isSaving;

  const handleSave = useCallback(async () => {
    if (parsed == null || parsed <= 0 || isSaving) return;
    hapticTap();
    setIsSaving(true);
    try {
      await onSubmit(parsed);
    } finally {
      setIsSaving(false);
    }
  }, [parsed, isSaving, onSubmit]);

  return (
    <div className={panelClass}>
      <div className="flex items-start gap-2">
        <PumpIcon />
        <div className="min-w-0">
          <p className="text-[12px] font-bold text-amber-700 dark:text-amber-300 tracking-tight">
            Gas hold, not the real amount
          </p>
          <p className="text-[11px] font-medium text-amber-700/80 dark:text-amber-400/80 mt-0.5">
            Your bank announced a {formatCurrency(hold.holdAmount)} hold. Covault is holding{' '}
            {formatCurrency(hold.placeholderAmount)}
            {/* Say where the estimate came from. "Your usual fill here" is a
                number the user can sanity-check; an unexplained $68.50 is not. */}
            {hold.basis === 'median-fill' ? ', your usual fill here,' : ''} until you say what you
            actually paid.
          </p>
        </div>
      </div>

      {open ? (
        <div className="flex items-center gap-2 mt-3">
          <div className="relative flex-1 min-w-0">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] font-bold text-amber-600 dark:text-amber-400 pointer-events-none">
              $
            </span>
            <input
              ref={inputRef}
              type="text"
              inputMode="decimal"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleSave();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setOpen(false);
                }
              }}
              disabled={isSaving}
              placeholder="0.00"
              aria-label="Amount actually paid"
              className="w-full min-h-[44px] pl-7 pr-3 text-[14px] font-bold rounded-2xl border border-amber-300 dark:border-amber-700/60 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-400/40 disabled:opacity-50"
            />
          </div>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSave}
            className={`shrink-0 ${primaryBtn}`}
          >
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 mt-3">
          <button type="button" onClick={() => setOpen(true)} className={`flex-1 ${primaryBtn}`}>
            Enter what you paid
          </button>
          <button
            type="button"
            onClick={() => {
              hapticTap();
              onKeepPlaceholder();
            }}
            className={`shrink-0 ${quietBtn}`}
          >
            Not now
          </button>
        </div>
      )}
    </div>
  );
};

interface SettlementOfferProps {
  candidate: SettlementCandidate;
  /** This charge is the settled amount: fold it into the placeholder row. */
  onMerge: () => Promise<void> | void;
  /** Two separate fills. Leave both alone and stop asking. */
  onKeepBoth: () => void;
}

/**
 * Offered on a real fuel charge that looks like the settlement of an earlier
 * hold.
 *
 * The question is put to the user rather than decided for them because the two
 * cases — a settlement arriving late, and simply filling up twice in a week —
 * are indistinguishable from the notifications alone. Merging the wrong pair
 * would delete a real purchase, so the destructive reading is never the default;
 * "Keep both" changes nothing and is always safe.
 */
export const FuelSettlementOffer: React.FC<SettlementOfferProps> = ({
  candidate,
  onMerge,
  onKeepBoth,
}) => {
  const [isMerging, setIsMerging] = useState(false);

  const handleMerge = useCallback(async () => {
    if (isMerging) return;
    hapticTap();
    setIsMerging(true);
    try {
      await onMerge();
    } finally {
      setIsMerging(false);
    }
  }, [isMerging, onMerge]);

  const when =
    candidate.daysApart === 0
      ? 'earlier today'
      : candidate.daysApart === 1
        ? 'yesterday'
        : `${candidate.daysApart} days ago`;

  return (
    <div className={panelClass}>
      <div className="flex items-start gap-2">
        <PumpIcon />
        <div className="min-w-0">
          <p className="text-[12px] font-bold text-amber-700 dark:text-amber-300 tracking-tight">
            Is this the real amount for that gas hold?
          </p>
          <p className="text-[11px] font-medium text-amber-700/80 dark:text-amber-400/80 mt-0.5">
            There's a {formatCurrency(candidate.holdAmount)} hold from {when} at the same station,
            still showing {formatCurrency(candidate.placeholderAmount)}. If this is the settled
            charge, Covault will replace it and keep one entry.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3">
        <button
          type="button"
          onClick={() => void handleMerge()}
          disabled={isMerging}
          className={`flex-1 ${primaryBtn}`}
        >
          {isMerging ? 'Merging…' : 'Yes, replace it'}
        </button>
        <button
          type="button"
          onClick={() => {
            hapticTap();
            onKeepBoth();
          }}
          className={`shrink-0 ${quietBtn}`}
        >
          Keep both
        </button>
      </div>
    </div>
  );
};

/** Accept "72", "72.43", "$72.43" and "1,072.43"; reject anything else. */
function parseAmount(input: string): number | null {
  const cleaned = (input || '').replace(/[$,\s]/g, '');
  if (!cleaned) return null;
  if (!/^\d*\.?\d{0,2}$/.test(cleaned)) return null;
  const value = parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

export default FuelHoldPrompt;

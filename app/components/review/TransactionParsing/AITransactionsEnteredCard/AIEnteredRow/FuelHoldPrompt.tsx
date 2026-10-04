import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { formatCurrency } from '../../../../../lib/money/formatCurrency';
import { hapticTap } from '../../../../../lib/native/haptics';
import AmountInput from '../../../../common/AmountInput';
import { manualAmountSchema } from '../../../../../lib/transactions/validation/manualEntry';
import type { FuelHold } from '../../../../../lib/capture/fuelHold';
import PumpIcon from './PumpIcon';
import { panelClass, primaryBtn, quietBtn } from './fuelHoldStyles';

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
const FuelHoldPrompt: React.FC<FuelHoldPromptProps> = ({
  hold,
  onSubmit,
  onKeepPlaceholder,
}) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [amountError, setAmountError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const helpId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const validation = manualAmountSchema.safeParse(draft);
  const parsed = validation.success ? validation.data : null;
  const canSave = parsed !== null && !amountError && !isSaving;

  const handleSave = useCallback(async () => {
    if (parsed === null || amountError || isSaving) return;
    hapticTap();
    setIsSaving(true);
    try {
      await onSubmit(parsed);
    } finally {
      setIsSaving(false);
    }
  }, [parsed, amountError, isSaving, onSubmit]);

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
        <div className="mt-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] font-bold text-amber-600 dark:text-amber-400 pointer-events-none">
                $
              </span>
              <AmountInput
                inputRef={inputRef}
                enterKeyHint="done"
                error={amountError}
                onErrorChange={setAmountError}
                aria-describedby={helpId}
                value={draft}
                onValueChange={setDraft}
                onValidEnter={() => { void handleSave(); }}
                onEscape={() => setOpen(false)}
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
          <p id={helpId} aria-live="polite" className={`mt-1.5 text-[11px] leading-snug ${amountError ? 'text-rose-700 dark:text-rose-400' : 'text-slate-600 dark:text-slate-400'}`}>
            {amountError ?? 'Use numbers and up to two decimal places.'}
          </p>
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

export default FuelHoldPrompt;

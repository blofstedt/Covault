import React, { useCallback, useState } from 'react';
import { formatCurrency } from '../../../../../lib/money/formatCurrency';
import { hapticTap } from '../../../../../lib/native/haptics';
import type { SettlementCandidate } from '../../../../../lib/capture/fuelHoldReconcile';
import PumpIcon from './PumpIcon';
import { panelClass, primaryBtn, quietBtn } from './fuelHoldStyles';

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
const FuelSettlementOffer: React.FC<SettlementOfferProps> = ({
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


export default FuelSettlementOffer;

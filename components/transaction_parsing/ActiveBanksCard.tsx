import React, { useEffect, useState } from 'react';
import ParsingCard from '../ui/ParsingCard';
import CaptureSourcePicker, {
  captureSourceCountFor,
  prefetchCaptureSources,
} from '../ui/CaptureSourcePicker';
import { covaultNotification } from '../../lib/covaultNotification';

interface ActiveBanksCardProps {
  isExpanded?: boolean;
  onToggleExpanded?: () => void;
}

/**
 * The apps Covault listens to, at the top of the Review page — and the place to
 * change them.
 *
 * This card used to be a read-only row of chips labelled "Active", listing what
 * the app had decided to monitor. It answered "what is Covault watching?" and
 * offered no way to argue with the answer, which was the wrong half of the
 * question: a bank the user did not want captured could not be removed, and a
 * bank that only ever emails could not be added at all.
 */
const ActiveBanksCard: React.FC<ActiveBanksCardProps> = ({
  isExpanded = true,
  onToggleExpanded,
}) => {
  const [count, setCount] = useState<number | undefined>(undefined);

  // Read the installed apps while the card is still shut. The picker only
  // exists once the card is open, so without this the wait for Android to list
  // every installed package began on the tap that opened it — and the user got
  // "Looking at what's installed…" instead of their banks, every time. It also
  // gives the closed card its count, the way the rules card has one.
  useEffect(() => {
    let cancelled = false;
    void prefetchCaptureSources(covaultNotification).then((options) => {
      if (!cancelled) setCount(captureSourceCountFor(options));
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <ParsingCard
      id="parsing-active-banks"
      colorScheme="blue"
      icon={
        <>
          <rect x="1" y="4" width="22" height="16" rx="2" />
          <line x1="1" y1="10" x2="23" y2="10" />
        </>
      }
      title="Where purchases come from"
      subtitle="The apps Covault reads — tap to change"
      count={count}
      collapsible
      isExpanded={isExpanded}
      onToggleExpanded={onToggleExpanded}
    >
      <CaptureSourcePicker
        plugin={covaultNotification}
        onSelectionChange={(selected) => setCount(selected.length)}
      />
    </ParsingCard>
  );
};

export default ActiveBanksCard;

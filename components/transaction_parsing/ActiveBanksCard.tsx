import React, { useState } from 'react';
import ParsingCard from '../ui/ParsingCard';
import CaptureSourcePicker from '../ui/CaptureSourcePicker';
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

import type React from 'react';
import type { SetupStepStatus } from '../../../../lib/native/notificationAccessSetup';
import { CLOCK } from '../motion';
import CheckMark from './CheckMark';

/**
 * The step marker: number while there is work to do, check once there isn't.
 *
 * `assumed` gets the same emerald as `done` but hollow — the step is behind
 * the user without ever having been confirmed, and claiming a solid tick for
 * something Android will not report would be a lie the user pays for later.
 */
const StepMarker: React.FC<{ status: SetupStepStatus; number: number }> = ({ status, number }) => {
  const base = `w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-bold ${CLOCK}`;

  if (status === 'done') {
    return (
      <span className={`${base} bg-emerald-500 text-white`}>
        <CheckMark />
      </span>
    );
  }
  if (status === 'assumed') {
    return (
      <span
        className={`${base} bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-300 dark:border-emerald-700/60 text-emerald-600 dark:text-emerald-400`}
      >
        <CheckMark />
      </span>
    );
  }
  if (status === 'active') {
    return <span className={`${base} bg-amber-500 text-white`}>{number}</span>;
  }
  return (
    <span className={`${base} bg-slate-200 dark:bg-slate-700/60 text-slate-400 dark:text-slate-500`}>
      {number}
    </span>
  );
};

export default StepMarker;

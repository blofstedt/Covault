import React, { useEffect, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import OnboardingStepShell from './OnboardingStepShell';
import CaptureSourcePicker from '../ui/CaptureSourcePicker';
import type { CovaultNotificationPlugin } from '../../lib/covaultNotification';

interface SourcesStepProps {
  stepNumber: number;
  stepCount: number;
  /** Whether Android has actually granted notification access yet. */
  captureEnabled: boolean;
  onNext: () => void;
  onSkip: () => void;
}

/**
 * "Which apps should Covault read?", asked once, during setup.
 *
 * Asked here rather than left to settings for two reasons. The defaults are
 * right for most people but not for everyone — somebody who does not want a
 * particular card captured has no way to know that is even a choice — and, more
 * to the point, the mail option is invisible unless somebody says it exists.
 * That option is the whole reason this feature was built: some banks announce a
 * purchase ONLY by email, and a user whose alerts arrive that way would
 * otherwise conclude capture simply does not work for their bank.
 *
 * Skippable, like every other step. The defaults are what the app would do
 * anyway, so passing this by costs nothing and changes nothing.
 */
const SourcesStep: React.FC<SourcesStepProps> = ({
  stepNumber,
  stepCount,
  captureEnabled,
  onNext,
  onSkip,
}) => {
  const isNative = Capacitor.isNativePlatform();
  const [plugin, setPlugin] = useState<CovaultNotificationPlugin | null>(null);

  useEffect(() => {
    if (!isNative) return;
    setPlugin(registerPlugin<CovaultNotificationPlugin>('CovaultNotification'));
  }, [isNative]);

  return (
    <OnboardingStepShell
      title="Which apps should we read?"
      subtitle="Covault only ever looks at the apps you tick here."
      stepNumber={stepNumber}
      stepCount={stepCount}
      primaryLabel="Continue"
      onPrimary={onNext}
      onSkip={onSkip}
      skipLabel="Use the defaults for now"
    >
      {isNative && plugin ? (
        <CaptureSourcePicker plugin={plugin} ready={captureEnabled} />
      ) : (
        // The picker draws nothing off-device, and an empty box in the middle of
        // a setup flow reads as a broken screen.
        <p className="text-center text-slate-400 dark:text-slate-500 text-xs font-medium tracking-wide leading-relaxed max-w-xs mx-auto">
          Choosing which apps to read happens on the Android app, where Covault
          can see your notifications. There's nothing to pick here.
        </p>
      )}
    </OnboardingStepShell>
  );
};

export default SourcesStep;

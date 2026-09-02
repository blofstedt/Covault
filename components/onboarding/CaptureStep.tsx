import React, { useEffect, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import OnboardingStepShell from './OnboardingStepShell';
import NotificationAccessGuide from '../NotificationAccessGuide';
import { clearSetupPending, markSetupPending } from '../../lib/notificationAccessSetup';
import type { CovaultNotificationPlugin } from '../../lib/covaultNotification';

interface CaptureStepProps {
  stepNumber: number;
  stepCount: number;
  /** Capture is already on — the user came back to a step that finished itself. */
  captureEnabled: boolean;
  onGranted: () => void;
  onNext: () => void;
  onSkip: () => void;
}

/**
 * The one setup step that leaves the app.
 *
 * Automatic capture is the reason to use Covault, and it was buried: the intro
 * mentioned it and pointed at "a guided setup in Settings" without opening it,
 * so a new user had to go and find a screen they had never seen. The guide is
 * the same one that has always lived in settings — this step is about WHERE the
 * user meets it, not about changing what it asks.
 *
 * `markSetupPending()` on mount is what makes the trip survivable. Android
 * destroys the WebView while the user is in its settings, so the flag has to be
 * on disk before they go; `useNotificationSetupCompletion` in App.tsx reads it
 * on the next launch and finishes switching capture on. Here the step IS the
 * intent, so there is no toggle to hang the flag off.
 */
const CaptureStep: React.FC<CaptureStepProps> = ({
  stepNumber,
  stepCount,
  captureEnabled,
  onGranted,
  onNext,
  onSkip,
}) => {
  const isNative = Capacitor.isNativePlatform();
  const [plugin, setPlugin] = useState<CovaultNotificationPlugin | null>(null);

  useEffect(() => {
    if (!isNative) return;
    setPlugin(registerPlugin<CovaultNotificationPlugin>('CovaultNotification'));
    markSetupPending();
  }, [isNative]);

  return (
    <OnboardingStepShell
      title="Capture your purchases"
      subtitle="Covault reads your bank's own alerts and writes the purchase down, with the app closed. Android needs to be told that's allowed."
      stepNumber={stepNumber}
      stepCount={stepCount}
      // The guide below carries its own action buttons; this one is only ever
      // "I am done with this step". Offering a Skip beside it would be two
      // controls that do the same thing with different words.
      primaryLabel={captureEnabled ? 'Continue' : 'Do this later'}
      onPrimary={captureEnabled ? onNext : onSkip}
    >
      {isNative && plugin ? (
        <NotificationAccessGuide
          plugin={plugin}
          onGranted={onGranted}
          onComplete={() => clearSetupPending()}
        />
      ) : (
        // The guide renders nothing off-device, and an empty box in the middle
        // of a setup flow reads as a broken screen. Say what the step is for
        // instead — the web build has no notifications to read.
        <p className="text-center text-slate-400 dark:text-slate-500 text-xs font-medium tracking-wide leading-relaxed max-w-xs mx-auto">
          Capture runs on the Android app, where Covault can see your bank's
          notifications. There's nothing to grant here.
        </p>
      )}
    </OnboardingStepShell>
  );
};

export default CaptureStep;

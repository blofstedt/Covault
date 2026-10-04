import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { handleBack } from '../../lib/navigation/backStack';

/**
 * Wires the phone's back button (the gesture, the on-screen key or a physical
 * one) to the back stack.
 *
 * Once any listener is registered Capacitor stops doing its own thing, so the
 * "nothing left to close" case is ours to handle. It sends the app to the
 * background rather than killing it: the capture listener lives in this
 * process, and a killed app is a few minutes of purchases that go unheard.
 */
export function useHardwareBack(): void {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;

    const handle = CapApp.addListener('backButton', () => {
      if (handleBack()) return;
      void CapApp.minimizeApp();
    });
    return () => { void handle.then(h => h.remove()); };
  }, []);
}

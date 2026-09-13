import { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  covaultNotification,
  canPostCaptureNotifications,
  getCaptureDiagnostics,
} from '../covaultNotification';
import { readBankLastSeen, captureOnSince, silentBanks } from '../bankHeartbeat';
import { getSelectedSources } from '../captureSources';
import type { CaptureHealthInput } from '../captureHealth';
import type { CaptureOutcome } from '../captureOutcome';
import { log } from '../log';

/**
 * Gathers what the phone knows about whether capture is working.
 *
 * Every one of these is already recorded somewhere — the heartbeat file, the
 * source list, the native diagnostics ring buffer, two permission checks. None
 * of it was ever shown in one place, which is why "a purchase didn't appear"
 * had no answer short of guessing.
 *
 * Read on demand rather than continuously: the card is collapsed by default,
 * and two permission round trips per render would be two round trips for a
 * question nobody asked. Refreshed when the card is opened and when the app
 * comes back to the foreground, since that is when a permission changed in
 * Android's settings would have changed underneath it.
 */
export function useCaptureHealth(captureEnabled: boolean): CaptureHealthInput & {
  refresh: () => Promise<void>;
} {
  const [listenerGranted, setListenerGranted] = useState(false);
  const [canPost, setCanPost] = useState(false);
  const [outcomes, setOutcomes] = useState<CaptureOutcome[]>([]);
  const [lastSeen, setLastSeen] = useState<Record<string, number>>({});
  const [silent, setSilent] = useState<string[]>([]);
  const [monitoredCount, setMonitoredCount] = useState(0);

  const refresh = useCallback(async () => {
    // The local reads are cheap and work everywhere, including the web build.
    const seen = readBankLastSeen();
    const sources = getSelectedSources();
    setLastSeen(seen);
    setMonitoredCount(sources.length);
    setSilent(silentBanks({ packages: sources, lastSeen: seen, onSince: captureOnSince() }));

    if (!Capacitor.isNativePlatform() || !covaultNotification) return;
    try {
      const [{ enabled }, posting, diagnostics] = await Promise.all([
        covaultNotification.isEnabled(),
        canPostCaptureNotifications(),
        getCaptureDiagnostics(),
      ]);
      setListenerGranted(enabled === true);
      setCanPost(posting);
      setOutcomes(diagnostics);
    } catch (e) {
      // A diagnostic that throws takes down the screen it was meant to
      // explain. Whatever was read stays; the rest reads as unknown.
      log.debug('[useCaptureHealth] read failed', e);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return {
    captureEnabled,
    listenerGranted,
    canPostNotifications: canPost,
    monitoredCount,
    lastSeen,
    silent,
    outcomes,
    refresh,
  };
}

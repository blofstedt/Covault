// lib/hooks/useAIModelOnDevice.ts
//
// Fetching the AI model at a moment nobody is waiting.
//
// The model used to arrive at the worst possible moment: mid-capture, when the
// parser was unsure about a purchase and something had to read it. ~70MB over
// whatever connection the phone happened to have, with the user watching an
// empty review list. This moves that download to a quiet moment instead —
// after the app has settled, on a connection that is not metered — and keeps
// what it fetched, so it happens once rather than whenever the phone feels
// like forgetting.
//
// Deliberately does nothing at all when the model is already here, when the
// phone is offline, on cellular, or has Data Saver on. Missing the moment
// costs nothing: it is asked again on the next launch, and the AI fallback
// still works exactly as it does today by fetching what it needs.

import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { log } from '../log';
import { downloadAIModelToDevice, readAIModelReport } from '../aiExtractor';
import { readConnection, shouldDownloadNow, type AIModelReport } from '../aiModelStore';

/** How long after mount to look, so nothing competes with the first paint. */
const SETTLE_MS = 8000;

export interface AIModelOnDevice {
  report: AIModelReport | null;
  downloading: boolean;
  /** Fetch it now regardless of the connection checks. For the settings screen. */
  downloadNow: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useAIModelOnDevice(enabled: boolean): AIModelOnDevice {
  const [report, setReport] = useState<AIModelReport | null>(null);
  const [downloading, setDownloading] = useState(false);
  // One attempt per app run. A failure is retried on the next launch rather
  // than in a loop, since the usual cause is a connection that is not going to
  // improve in the next few seconds.
  const attempted = useRef(false);

  const refresh = async () => {
    try {
      setReport(await readAIModelReport());
    } catch (e) {
      log.warn('[aiModel] Could not read what is stored:', e);
    }
  };

  const run = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      setReport(await downloadAIModelToDevice());
    } catch (e) {
      log.warn('[aiModel] Could not put the model on this phone:', e);
      await refresh();
    } finally {
      setDownloading(false);
    }
  };

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const timer = setTimeout(async () => {
      if (cancelled || attempted.current) return;
      // Only the installed app fetches this on its own. On the web the model
      // earns nothing by being kept — a visitor may never trigger the reading
      // model at all, and 70MB of background download on someone else's
      // connection is not ours to spend. The settings button still works
      // everywhere for anyone who wants it.
      if (!Capacitor.isNativePlatform()) {
        setReport(await readAIModelReport());
        return;
      }
      const current = await readAIModelReport();
      if (cancelled) return;
      setReport(current);
      if (!shouldDownloadNow(readConnection(), current.state)) {
        log.debug('[aiModel] Not fetching the model right now:', current.state);
        return;
      }
      attempted.current = true;
      await run();
    }, SETTLE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `enabled` is the only input; everything else is read at fire time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { report, downloading, downloadNow: run, refresh };
}

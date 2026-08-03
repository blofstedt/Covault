import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import {
  AvailableUpdate,
  fetchLatestRelease,
  getInstalledVersionCode,
  selectUpdate,
} from '../appUpdate';
import { covaultUpdater } from '../covaultUpdater';
import { log } from '../log';

/**
 * Keeps the phone on the newest build without anyone downloading an APK by
 * hand.
 *
 * What this can and cannot do is set by Android, not by us: a normal app may
 * fetch an APK and open the installer, but the system's own "update this app?"
 * confirmation is mandatory and there is no API that skips it. So the honest
 * ceiling is *one tap* — Covault notices, downloads in the background, and the
 * user confirms. It is never silent.
 *
 * Checks run on launch and on resume rather than on a timer, because the app is
 * backgrounded rather than closed and a timer in a frozen process proves
 * nothing. They are throttled: GitHub allows 60 unauthenticated requests an
 * hour per address, shared with everyone else on the same connection.
 */

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const LAST_CHECK_KEY = 'covault_update_last_check';
const DISMISSED_KEY = 'covault_update_dismissed';
const POLL_INTERVAL_MS = 500;
/** A stalled download should give up rather than spin the ring forever. */
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

export type UpdatePhase = 'idle' | 'downloading' | 'installing';

export interface AppUpdate {
  /** The update to offer, or null when there is nothing to say. */
  update: AvailableUpdate | null;
  phase: UpdatePhase;
  /** 0–100 while downloading. */
  percent: number;
  /** Something the user can act on, in their words. */
  error: string | null;
  install: () => void;
  dismiss: () => void;
}

function readNumber(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function writeNumber(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // A full or blocked localStorage costs us the throttle, not the feature.
  }
}

export function useAppUpdate(): AppUpdate {
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [phase, setPhase] = useState<UpdatePhase>('idle');
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Read inside callbacks that must not re-subscribe when it changes.
  const phaseRef = useRef<UpdatePhase>('idle');
  phaseRef.current = phase;
  const pollTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (pollTimer.current !== undefined) clearInterval(pollTimer.current);
    };
  }, []);

  const check = useCallback(async (force: boolean) => {
    if (!Capacitor.isNativePlatform()) return;
    // Never interrupt a download in progress with a fresh answer.
    if (phaseRef.current !== 'idle') return;

    const last = readNumber(LAST_CHECK_KEY);
    if (!force && last !== null && Date.now() - last < CHECK_INTERVAL_MS) return;
    writeNumber(LAST_CHECK_KEY, Date.now());

    const [latest, installed] = await Promise.all([
      fetchLatestRelease(),
      getInstalledVersionCode(),
    ]);
    const next = selectUpdate(latest, installed);
    if (!mounted.current) return;

    // A version the user has already waved away stays away until the one after
    // it. Nagging on every resume is how a good prompt becomes a bad one.
    if (next && readNumber(DISMISSED_KEY) === next.versionCode) return;
    setUpdate(next);
  }, []);

  useEffect(() => {
    void check(false);

    if (!Capacitor.isNativePlatform()) return;
    const handle = CapApp.addListener('resume', () => { void check(false); });
    return () => { void handle.then(h => h.remove()); };
  }, [check]);

  const fallbackToBrowser = useCallback(async (url: string) => {
    // The native path is the nice one, not the only one. If DownloadManager is
    // disabled or the installer refuses the handoff, the browser still gets
    // them the APK — the same route they use today.
    try {
      await Browser.open({ url });
    } catch (e) {
      log.warn('[useAppUpdate] Could not open the download in a browser:', e);
    }
  }, []);

  const install = useCallback(() => {
    const target = update;
    if (!target || phaseRef.current !== 'idle') return;

    void (async () => {
      setError(null);

      if (!covaultUpdater) {
        await fallbackToBrowser(target.apkUrl);
        return;
      }

      try {
        const { canInstall } = await covaultUpdater.getStatus();
        if (!canInstall) {
          // There is no inline prompt for this one; Settings is the only door.
          await covaultUpdater.openInstallSettings();
          if (mounted.current) {
            setError('Allow Covault to install apps, then tap Update again.');
          }
          return;
        }
      } catch (e) {
        log.warn('[useAppUpdate] Could not read install permission:', e);
      }

      let id: string;
      try {
        ({ id } = await covaultUpdater.startDownload({ url: target.apkUrl }));
      } catch (e) {
        log.warn('[useAppUpdate] Could not start the download:', e);
        await fallbackToBrowser(target.apkUrl);
        return;
      }

      if (!mounted.current) return;
      setPhase('downloading');
      phaseRef.current = 'downloading';
      setPercent(0);

      const startedAt = Date.now();
      const stop = () => {
        if (pollTimer.current !== undefined) {
          clearInterval(pollTimer.current);
          pollTimer.current = undefined;
        }
      };

      pollTimer.current = setInterval(() => {
        void (async () => {
          if (!covaultUpdater) return;
          let status: 'pending' | 'running' | 'done' | 'failed';
          let pct = 0;
          try {
            ({ status, percent: pct } = await covaultUpdater.pollDownload({ id }));
          } catch (e) {
            log.warn('[useAppUpdate] Lost track of the download:', e);
            status = 'failed';
          }

          if (!mounted.current) { stop(); return; }

          if (status === 'running' || status === 'pending') {
            setPercent(pct);
            if (Date.now() - startedAt > DOWNLOAD_TIMEOUT_MS) {
              stop();
              setPhase('idle');
              phaseRef.current = 'idle';
              setError('The download stalled. Tap Update to try again.');
            }
            return;
          }

          stop();

          if (status === 'failed') {
            setPhase('idle');
            phaseRef.current = 'idle';
            setError('The download failed. Tap Update to try again.');
            return;
          }

          setPercent(100);
          setPhase('installing');
          phaseRef.current = 'installing';
          try {
            await covaultUpdater.install({ id });
          } catch (e) {
            log.warn('[useAppUpdate] Could not open the installer:', e);
            if (mounted.current) {
              setPhase('idle');
              phaseRef.current = 'idle';
            }
            await fallbackToBrowser(target.apkUrl);
          }
        })();
      }, POLL_INTERVAL_MS);
    })();
  }, [update, fallbackToBrowser]);

  const dismiss = useCallback(() => {
    if (update) writeNumber(DISMISSED_KEY, update.versionCode);
    setUpdate(null);
    setError(null);
  }, [update]);

  return { update, phase, percent, error, install, dismiss };
}

export default useAppUpdate;

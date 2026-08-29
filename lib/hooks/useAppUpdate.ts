import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import {
  AvailableUpdate,
  fetchLatestRelease,
  getInstalledVersionCode,
  selectUpdate,
  selectWebBundle,
} from '../appUpdate';
import { covaultUpdater, type CovaultUpdaterPlugin } from '../covaultUpdater';
import { log } from '../log';

/**
 * Keeps the phone on the newest build without anyone downloading an APK by
 * hand.
 *
 * Two routes, and which one is taken is not a preference — it is what the
 * change actually touched:
 *
 *  - **Web-only changes take themselves.** Almost everything here is React and
 *    TypeScript, and that layer can be replaced on the phone without
 *    reinstalling anything. The new bundle is fetched quietly, unpacked, and
 *    picked up the next time Covault starts cold. Nobody taps anything and
 *    nothing interrupts. If it turns out not to start, the native side puts the
 *    previous version back after two launches.
 *
 *  - **Anything touching the Android code needs the APK.** That one is fetched
 *    quietly too, the moment it is found, so nobody ever waits on a progress
 *    bar — and then Covault asks Android to replace itself with it while the
 *    app is in the background, where being killed and swapped costs nothing.
 *    Android allows an app to update itself without a confirmation once it is
 *    its own installer of record, which Covault becomes the first time it
 *    installs itself. Until then, and on any phone or build where the OS
 *    refuses, the pill appears and costs one tap — on an APK that is already
 *    downloaded, so the tap is the whole of it.
 *
 * The two are told apart by a fingerprint of the native source baked into the
 * APK (scripts/native-hash.mjs). A web bundle is published under the
 * fingerprint it was built against, and a phone only applies a bundle carrying
 * its own. When the native code changes, no bundle matches and the update falls
 * through to the APK prompt on its own.
 *
 * Checks run on launch and on resume rather than on a timer, because the app is
 * backgrounded rather than closed and a timer in a frozen process proves
 * nothing. They are throttled: GitHub allows 60 unauthenticated requests an
 * hour per address, shared with everyone else on the same connection.
 */

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
/**
 * Floor for a check the app asks for rather than one a resume triggered.
 *
 * Opening Covault deliberately, seconds after a release, used to be answered
 * with the fifteen-minute throttle and nothing else — the app didn't even
 * look. A cold launch now always asks; this only stops a burst of remounts
 * (the reload after applying a bundle, a configuration change) from spending
 * the hourly GitHub allowance on the same question.
 */
const LAUNCH_CHECK_FLOOR_MS = 60 * 1000;
const LAST_CHECK_KEY = 'covault_update_last_check';
const DISMISSED_KEY = 'covault_update_dismissed';
/**
 * The APK that has already been downloaded and is waiting to be installed.
 *
 * Written down rather than held in state because the whole point is that it
 * outlives the session that fetched it: the download happens whenever the
 * update is noticed, and the install happens the next time the app goes to the
 * background, which may be days and several launches later.
 */
const APK_READY_KEY = 'covault_update_apk_ready';
const POLL_INTERVAL_MS = 500;
/** A stalled download should give up rather than spin the ring forever. */
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const WEB_BUNDLE_FILE = 'covault-web.zip';
/** Nothing in the background path needs to be checked four times a second. */
const WEB_POLL_INTERVAL_MS = 2000;
/**
 * How long the app has to stay up before a freshly applied web bundle is
 * considered good. Long enough to have rendered and settled; short enough that
 * a quick look at the app still counts.
 */
const CONFIRM_DELAY_MS = 5000;

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
  /**
   * Version of a downloaded web bundle that is waiting for a reload, or null.
   *
   * It would arrive on its own at the next cold start; this exists so someone
   * who knows a fix has shipped doesn't have to close the app to get it.
   */
  webUpdateReady: number | null;
  /** Reload onto that bundle now. Replaces the running app. */
  applyWebUpdate: () => void;
  /**
   * Version of an APK already downloaded and waiting, or null.
   *
   * Only ever affects what the pill says. Everything about the update works
   * the same either way; this is the difference between "tap and then wait"
   * and "tap and it's done".
   */
  apkReady: number | null;
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

/** A downloaded APK, remembered across launches. */
export interface ReadyApk {
  version: number;
  /** DownloadManager id, as the string the plugin deals in. */
  id: string;
}

function readReadyApk(): ReadyApk | null {
  try {
    const raw = localStorage.getItem(APK_READY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ReadyApk>;
    if (typeof parsed?.version !== 'number' || typeof parsed?.id !== 'string') return null;
    if (!Number.isFinite(parsed.version) || !parsed.id) return null;
    return { version: parsed.version, id: parsed.id };
  } catch {
    return null;
  }
}

function writeReadyApk(value: ReadyApk | null): void {
  try {
    if (value) localStorage.setItem(APK_READY_KEY, JSON.stringify(value));
    else localStorage.removeItem(APK_READY_KEY);
  } catch {
    // Costs the head start, not the update: without the record the APK is
    // simply downloaded again next time.
  }
}

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Wait for a queued download, resolving true only when the file is on disk.
 *
 * Separate from the APK path's polling on purpose: this one reports nothing,
 * because there is no one watching it.
 */
async function waitForDownload(plugin: CovaultUpdaterPlugin, id: string): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < DOWNLOAD_TIMEOUT_MS) {
    await delay(WEB_POLL_INTERVAL_MS);
    const { status } = await plugin.pollDownload({ id });
    if (status === 'done') return true;
    if (status === 'failed') return false;
  }
  return false;
}

export function useAppUpdate(): AppUpdate {
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [webUpdateReady, setWebUpdateReady] = useState<number | null>(null);
  /** Version of a downloaded APK sitting on the phone, or null. */
  const [apkReady, setApkReady] = useState<number | null>(readReadyApk()?.version ?? null);
  const [phase, setPhase] = useState<UpdatePhase>('idle');
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Read inside callbacks that must not re-subscribe when it changes.
  const phaseRef = useRef<UpdatePhase>('idle');
  phaseRef.current = phase;
  const pollTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const mounted = useRef(true);
  /** A background web bundle is being fetched; don't start a second one. */
  const staging = useRef(false);
  /** Same, for the APK. */
  const fetchingApk = useRef(false);
  /** The downloaded APK, if there is one. Mirrors APK_READY_KEY. */
  const readyApk = useRef<ReadyApk | null>(readReadyApk());
  /** Set once a quiet install has been attempted for this APK this session. */
  const quietInstallTried = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (pollTimer.current !== undefined) clearInterval(pollTimer.current);
    };
  }, []);

  /**
   * Fetch the new web bundle and hand it to the native side. Silent from start
   * to finish — a failure here just means the app stays on the version it has.
   */
  const stageWebUpdate = useCallback(async (version: number, url: string) => {
    if (!covaultUpdater || staging.current) return;
    staging.current = true;
    try {
      const { id } = await covaultUpdater.startDownload({ url, fileName: WEB_BUNDLE_FILE });
      if (!(await waitForDownload(covaultUpdater, id))) {
        log.warn('[useAppUpdate] Web bundle download did not finish');
        return;
      }
      await covaultUpdater.stageWebBundle({ id, version });
      log.info(`[useAppUpdate] Web bundle ${version} staged for next launch`);
      // It will arrive by itself at the next cold start. Saying so lets the
      // user have it now instead.
      if (mounted.current) setWebUpdateReady(version);
    } catch (e) {
      log.warn('[useAppUpdate] Could not stage the web bundle:', e);
    } finally {
      staging.current = false;
    }
  }, []);

  /**
   * Fetch the APK in the background, exactly as a web bundle is fetched.
   *
   * The download used to start on the tap, so the pill was a promise of a wait:
   * tap, watch a progress bar for however long the connection took, then
   * confirm. Doing it here means the tap — where a tap is still needed at all —
   * lands on a file that is already on the phone.
   *
   * Silent throughout, including in the notification shade: this is not
   * something the user asked for, so a progress bar and a "download complete"
   * for it would be noise about a thing they never requested.
   */
  const fetchApkUpdate = useCallback(async (version: number, url: string) => {
    if (!covaultUpdater || fetchingApk.current) return;
    if (readyApk.current?.version === version) return;
    fetchingApk.current = true;
    try {
      const { id } = await covaultUpdater.startDownload({ url, quiet: true });
      if (!(await waitForDownload(covaultUpdater, id))) {
        log.warn('[useAppUpdate] APK download did not finish');
        return;
      }
      readyApk.current = { version, id };
      quietInstallTried.current = false;
      writeReadyApk(readyApk.current);
      log.info(`[useAppUpdate] APK ${version} downloaded and waiting`);
      if (mounted.current) setApkReady(version);
    } catch (e) {
      log.warn('[useAppUpdate] Could not fetch the APK:', e);
    } finally {
      fetchingApk.current = false;
    }
  }, []);

  /**
   * Ask Android to install the downloaded APK without asking the user.
   *
   * Only ever called as the app goes to the background. A self-update replaces
   * the process, so doing this in the foreground would close the app in the
   * user's hands mid-sentence; doing it here means the update has simply
   * happened by the next time they open Covault, which is what an update should
   * feel like.
   *
   * A refusal is not a failure and is not reported. Android answers
   * `prompt-needed` whenever it wants the user asked — every phone below
   * Android 12, and the first update on any phone, because Covault is not yet
   * its own installer of record — and the pill is still there to handle it.
   */
  const installQuietly = useCallback(async () => {
    const ready = readyApk.current;
    if (!covaultUpdater || !ready || quietInstallTried.current) return;
    quietInstallTried.current = true;
    try {
      const { canInstall, quietInstallSupported } = await covaultUpdater.getStatus();
      if (!canInstall) return;
      // An older plugin would read the flag as an ordinary install and open the
      // system installer on top of whatever app the user has just switched to.
      if (!quietInstallSupported) return;
      const { mode } = await covaultUpdater.install({ id: ready.id, silent: true });
      log.info(`[useAppUpdate] Quiet install: ${mode}`);
    } catch (e) {
      log.warn('[useAppUpdate] Quiet install could not be attempted:', e);
    }
  }, []);

  const check = useCallback(async (force: boolean) => {
    if (!Capacitor.isNativePlatform()) return;
    // Never interrupt a download in progress with a fresh answer.
    if (phaseRef.current !== 'idle' || staging.current) return;

    const last = readNumber(LAST_CHECK_KEY);
    const floor = force ? LAUNCH_CHECK_FLOOR_MS : CHECK_INTERVAL_MS;
    if (last !== null && Date.now() - last < floor) return;
    writeNumber(LAST_CHECK_KEY, Date.now());

    let status: Awaited<ReturnType<CovaultUpdaterPlugin['getStatus']>> | null = null;
    try {
      status = (await covaultUpdater?.getStatus()) ?? null;
    } catch (e) {
      log.warn('[useAppUpdate] Could not read the updater status:', e);
    }

    // Before anything to do with the network: a bundle taken on an earlier
    // pass may still be waiting for a reload, and the release check below
    // finds nothing new once it has been staged.
    if (status && status.stagedWebVersion > status.runningWebVersion) {
      setWebUpdateReady(status.stagedWebVersion);
    }

    const latest = await fetchLatestRelease();

    // What the phone is actually running: the APK's version, or a newer web
    // bundle applied on top of it. Comparing against the APK alone would offer
    // the same update again after every background update.
    const apkVersion = status?.apkVersion || (await getInstalledVersionCode()) || 0;
    const running = Math.max(apkVersion, status?.webVersion ?? 0);

    // A downloaded APK that has since been installed — quietly or by hand — is
    // no longer news. Cleared before anything is offered so the pill can't
    // advertise an update the phone is already running.
    if (readyApk.current && apkVersion >= readyApk.current.version) {
      readyApk.current = null;
      writeReadyApk(null);
      if (mounted.current) setApkReady(null);
    }

    const next = selectUpdate(latest, running || null);
    if (!mounted.current || !next) return;

    const webUrl = selectWebBundle(next, status?.nativeHash ?? '');
    if (webUrl) {
      // Web-only change: take it quietly and say nothing.
      void stageWebUpdate(next.versionCode, webUrl);
      return;
    }

    // Fetch it whether or not the pill is going to be shown. Waving the pill
    // away means "stop telling me", not "stay on the old build" — and the
    // quiet install is what makes that distinction worth having.
    void fetchApkUpdate(next.versionCode, next.apkUrl);

    // A version the user has already waved away stays away until the one after
    // it. Nagging on every resume is how a good prompt becomes a bad one.
    if (readNumber(DISMISSED_KEY) === next.versionCode) return;
    setUpdate(next);
  }, [stageWebUpdate, fetchApkUpdate]);

  useEffect(() => {
    // Opening the app is someone asking, so it always asks — subject only to
    // the one-minute floor. A resume is not; it keeps the long throttle.
    void check(true);

    if (!Capacitor.isNativePlatform()) return;
    const resumed = CapApp.addListener('resume', () => { void check(false); });
    // Leaving the app is the one moment a self-update costs nothing: the
    // process is about to stop mattering, and by the next launch the new build
    // is simply the one that starts.
    const paused = CapApp.addListener('pause', () => { void installQuietly(); });
    return () => {
      void resumed.then(h => h.remove());
      void paused.then(h => h.remove());
    };
  }, [check, installQuietly]);

  // A bundle can be staged and waiting from an earlier session, and the check
  // above may be inside its floor and never look. This costs no network.
  useEffect(() => {
    if (!covaultUpdater) return;
    void (async () => {
      try {
        const status = await covaultUpdater.getStatus();
        if (!mounted.current) return;
        if (status.stagedWebVersion > status.runningWebVersion) {
          setWebUpdateReady(status.stagedWebVersion);
        }
      } catch (e) {
        log.warn('[useAppUpdate] Could not read the updater status:', e);
      }
    })();
  }, []);

  // Tell the native side this launch worked out.
  //
  // Deliberately on a delay rather than at mount: the point is to prove the app
  // reached a usable state, and a component that mounts and then throws would
  // have already confirmed a bundle that doesn't work. Two launches without
  // this arriving and the previous version is put back.
  useEffect(() => {
    if (!covaultUpdater) return;
    const timer = setTimeout(() => {
      covaultUpdater?.confirmWebBundle().catch(e => {
        log.warn('[useAppUpdate] Could not confirm this launch:', e);
      });
    }, CONFIRM_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

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

      // Already downloaded in the background: straight to the installer, with
      // no progress bar in between. This is the common case now — the tap only
      // exists because Android wants a confirmation.
      const ready = readyApk.current;
      if (ready && ready.version === target.versionCode) {
        setPhase('installing');
        phaseRef.current = 'installing';
        setPercent(100);
        try {
          await covaultUpdater.install({ id: ready.id });
          return;
        } catch (e) {
          log.warn('[useAppUpdate] Could not open the installer for the ready APK:', e);
          // The record is the suspect part — a download row cleared out from
          // under us looks exactly like this — so drop it and fetch again
          // rather than sending the user to a browser over a stale id.
          readyApk.current = null;
          writeReadyApk(null);
          if (mounted.current) {
            setApkReady(null);
            setPhase('idle');
          }
          phaseRef.current = 'idle';
        }
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

  // Reload onto a bundle that has already been downloaded. Nothing after the
  // call runs — the WebView is replaced — so there is no success path to
  // handle here, only the refusal.
  const applyWebUpdate = useCallback(() => {
    if (!covaultUpdater || webUpdateReady === null) return;
    void covaultUpdater.applyWebBundleNow().catch(e => {
      log.warn('[useAppUpdate] Could not switch to the staged bundle:', e);
      if (!mounted.current) return;
      setWebUpdateReady(null);
      setError('That version could not be opened. It will be applied next time Covault starts.');
    });
  }, [webUpdateReady]);

  const dismiss = useCallback(() => {
    if (update) writeNumber(DISMISSED_KEY, update.versionCode);
    setUpdate(null);
    // Waved away only for this session: the bundle is still applied at the
    // next cold start, so there is no version to remember having refused.
    setWebUpdateReady(null);
    setError(null);
  }, [update]);

  return {
    update, phase, percent, error, install, dismiss, webUpdateReady, applyWebUpdate, apkReady,
  };
}

export default useAppUpdate;

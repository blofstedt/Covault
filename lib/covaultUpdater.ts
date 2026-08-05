import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * Bridge to `android-custom/CovaultUpdaterPlugin.java`.
 *
 * Three calls rather than one: the native side queues the download and returns
 * straight away, JavaScript polls it, and asks for the install when it lands.
 * See the plugin for why the download isn't awaited natively.
 */
export interface UpdaterStatus {
  /** Whether Android currently lets Covault install an APK at all. */
  canInstall: boolean;
  /** versionCode of the installed APK. */
  apkVersion: number;
  /** Version of the applied web bundle; 0 means the one inside the APK. */
  webVersion: number;
  /** Bundle version sitting on disk, applied or not. */
  stagedWebVersion: number;
  /**
   * Bundle version this launch is actually serving. Lower than the staged one
   * means a downloaded update is waiting for a reload.
   */
  runningWebVersion: number;
  /**
   * Fingerprint of this APK's native code. Empty means unknown, which the
   * caller must read as "never apply a web bundle".
   */
  nativeHash: string;
}

export interface CovaultUpdaterPlugin {
  getStatus(): Promise<UpdaterStatus>;
  /** Send the user to the Settings page where install permission is granted. */
  openInstallSettings(): Promise<void>;
  /** Queue the download; the id comes back as a string. */
  startDownload(options: { url: string; fileName?: string }): Promise<{ id: string }>;
  pollDownload(options: { id: string }): Promise<{
    status: 'pending' | 'running' | 'done' | 'failed';
    percent: number;
  }>;
  /** Hand the finished download to Android's installer. */
  install(options: { id: string }): Promise<void>;
  /**
   * Unpack a downloaded web bundle and serve it from the next launch onwards.
   * Nothing changes in the running app.
   */
  stageWebBundle(options: { id: string; version: number }): Promise<void>;
  /**
   * Reload the running app onto the staged bundle immediately. The WebView is
   * replaced, so nothing after this call runs.
   */
  applyWebBundleNow(): Promise<void>;
  /** Tell the native side this launch succeeded, ending a bundle's probation. */
  confirmWebBundle(): Promise<void>;
  /** Go back to the web build inside the APK. */
  revertWebBundle(): Promise<void>;
}

const plugin = registerPlugin<CovaultUpdaterPlugin>('CovaultUpdater');

/**
 * Null anywhere the native plugin cannot exist (the browser dev server, the
 * Vercel build), so callers branch on one thing instead of guarding every use.
 */
export const covaultUpdater: CovaultUpdaterPlugin | null =
  Capacitor.isNativePlatform() ? plugin : null;

export default covaultUpdater;

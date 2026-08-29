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
  /**
   * Whether this build can be asked to install without a confirmation.
   *
   * Absent on an older plugin, which is the point: `install({silent:true})`
   * there would be read as an ordinary install and open the system installer,
   * and the only caller of the silent form runs while the app is in the
   * background, where that would surface on top of whatever the user is
   * actually doing.
   */
  quietInstallSupported?: boolean;
}

export interface CovaultUpdaterPlugin {
  getStatus(): Promise<UpdaterStatus>;
  /** Send the user to the Settings page where install permission is granted. */
  openInstallSettings(): Promise<void>;
  /**
   * Queue the download; the id comes back as a string.
   *
   * `quiet` keeps it out of the notification shade, for a download nobody
   * asked for and nobody is waiting on.
   */
  startDownload(options: {
    url: string;
    fileName?: string;
    quiet?: boolean;
  }): Promise<{ id: string }>;
  pollDownload(options: { id: string }): Promise<{
    status: 'pending' | 'running' | 'done' | 'failed';
    percent: number;
  }>;
  /**
   * Install the finished download.
   *
   * `silent` asks Android to replace the app without a confirmation, which it
   * allows for an app updating itself once that app is its own installer of
   * record. Only for use when nobody is looking: the answer is `quiet` when the
   * request was accepted and `prompt-needed` when Android wants the user asked,
   * and the second is not a failure — the APK stays on disk and the ordinary
   * route still works.
   */
  install(options: { id: string; silent?: boolean }): Promise<{
    mode?: 'quiet' | 'prompt-needed' | 'prompt';
  }>;
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

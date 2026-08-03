import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * Bridge to `android-custom/CovaultUpdaterPlugin.java`.
 *
 * Three calls rather than one: the native side queues the download and returns
 * straight away, JavaScript polls it, and asks for the install when it lands.
 * See the plugin for why the download isn't awaited natively.
 */
export interface CovaultUpdaterPlugin {
  /** Whether Android currently lets Covault install an APK at all. */
  getStatus(): Promise<{ canInstall: boolean }>;
  /** Send the user to the Settings page where that is granted. */
  openInstallSettings(): Promise<void>;
  /** Queue the download; the id comes back as a string. */
  startDownload(options: { url: string }): Promise<{ id: string }>;
  pollDownload(options: { id: string }): Promise<{
    status: 'pending' | 'running' | 'done' | 'failed';
    percent: number;
  }>;
  /** Hand the finished download to Android's installer. */
  install(options: { id: string }): Promise<void>;
}

const plugin = registerPlugin<CovaultUpdaterPlugin>('CovaultUpdater');

/**
 * Null anywhere the native plugin cannot exist (the browser dev server, the
 * Vercel build), so callers branch on one thing instead of guarding every use.
 */
export const covaultUpdater: CovaultUpdaterPlugin | null =
  Capacitor.isNativePlatform() ? plugin : null;

export default covaultUpdater;

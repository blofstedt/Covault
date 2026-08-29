import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * Bridge to `android-custom/CovaultWidgetPlugin.java`.
 *
 * Two calls: check, then ask. Kept separate so the settings screen can decide
 * what to show — the button, or the written steps — before it commits to
 * anything, the same shape as `canPostCaptureNotifications` /
 * `requestPostNotifications` for the notification-access flow.
 */
export interface CovaultWidgetPlugin {
  /** Whether this Android version and launcher can be asked at all. */
  isSupported(): Promise<{ supported: boolean }>;
  /**
   * Ask the launcher to place the widget. `requested: true` means the
   * launcher accepted and is showing its own placement screen — not proof
   * the user finished. Nothing on this side can see past the request.
   */
  requestPin(): Promise<{ requested: boolean }>;
}

export const covaultWidget: CovaultWidgetPlugin | null = Capacitor.isNativePlatform()
  ? registerPlugin<CovaultWidgetPlugin>('CovaultWidget')
  : null;

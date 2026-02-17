// lib/covaultNotification.ts
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface TransactionDetectedEvent {
  /**
   * Full text of the notification from the bank app.
   * Example: "Scotiabank: Purchase of $56.12 at McDonalds..."
   */
  rawNotification?: string;

  /**
   * Android package name of the banking app.
   * Example: "com.scotiabank.mobile"
   */
  bankAppId?: string;

  /**
   * Human-readable bank name.
   * Example: "Scotiabank"
   */
  bankName?: string;

  /**
   * Optional fallback vendor parsed natively (you can keep this for now).
   */
  vendor?: string;

  /**
   * Optional fallback amount parsed natively (you can keep this for now).
   */
  amount?: number;

  /** Alternative field name for rawNotification sent by the native Android broadcast. */
  raw_text?: string;

  /** Alternative field name for bankAppId sent by the native Android broadcast. */
  source_app?: string;

  /**
   * Original notification post time (epoch millis) from Android.
   * Stable across rescans — used for fingerprint deduplication.
   */
  timestamp?: number;
}

export interface CovaultNotificationPlugin {
  // You already have methods like these in your other repo:
  requestAccess(): Promise<void>;
  isEnabled(): Promise<{ enabled: boolean }>;
  getInstalledApps(): Promise<{ apps: Array<{ packageName: string; name: string }> }>;
  saveMonitoredApps(options: { apps: any }): Promise<void>;
  getMonitoredApps(): Promise<{ apps: string[] }>;

  /**
   * Scan all currently active (visible) notifications in the Android notification
   * shade and re-process any that come from monitored banking apps.
   * Each matching notification will fire a 'transactionDetected' event
   * through the normal pipeline (which includes fingerprint deduplication).
   */
  scanActiveNotifications(): Promise<void>;

  // Our event: emits whenever a transaction notification is detected
  addListener(
    eventName: 'transactionDetected',
    listener: (event: TransactionDetectedEvent) => void
  ): Promise<{ remove: () => void }>;
}

/**
 * Safe way to access the native CovaultNotification plugin.
 * Uses registerPlugin for proper event listener support.
 * Returns null on web / non-native platforms.
 */
export const covaultNotification: CovaultNotificationPlugin | null =
  Capacitor.isNativePlatform()
    ? registerPlugin<CovaultNotificationPlugin>('CovaultNotification')
    : null;

/**
 * Auto-detect installed banking apps and save them as monitored apps
 * so the notification listener can monitor them immediately on fresh install,
 * without waiting for the user to open notification settings.
 *
 * Only runs on native platforms and only saves when no monitored apps
 * have been configured yet (preserves user customizations).
 */
export async function autoDetectAndSaveMonitoredApps(
  knownBankingApps: Record<string, string>,
): Promise<void> {
  if (!covaultNotification) return;

  try {
    const { apps: saved } = await covaultNotification.getMonitoredApps();
    const { apps: installed } = await covaultNotification.getInstalledApps();
    const bankingPackages = installed
      .filter(app => app.packageName in knownBankingApps)
      .map(app => app.packageName);

    if (bankingPackages.length === 0) return;

    // Merge with existing selections so newly installed banking apps
    // are picked up without overwriting the user's previous choices.
    const savedSet = new Set(saved || []);
    let changed = false;
    for (const pkg of bankingPackages) {
      if (!savedSet.has(pkg)) {
        savedSet.add(pkg);
        changed = true;
      }
    }

    if (changed) {
      await covaultNotification.saveMonitoredApps({ apps: Array.from(savedSet) });
      console.log(
        `[autoDetect] Saved ${savedSet.size} monitored banking apps (${bankingPackages.length} installed)`,
      );
    }
  } catch (e) {
    console.warn('[autoDetect] Error during banking app auto-detection:', e);
  }
}

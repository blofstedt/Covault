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

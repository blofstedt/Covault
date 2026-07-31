// lib/covaultNotification.ts
import { log } from './log';
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

  /**
   * True when this event came from an explicit user-triggered rescan of the
   * active notification shade (vs. a fresh notification being received).
   * The native side may use either snake_case or camelCase depending on
   * serialization path, so we accept both.
   */
  from_scan?: boolean;
  /** camelCase alias for `from_scan`. */
  fromScan?: boolean;
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

  /**
   * Hand over notifications the native listener captured while the JS side was
   * not running, and clear the native queue.
   *
   * The listener service outlives the WebView, so a notification arriving with
   * the app closed is broadcast to nobody. Draining on launch/resume means the
   * user no longer has to open the app and hit refresh before dismissing it.
   */
  drainPendingNotifications(): Promise<{ notifications: TransactionDetectedEvent[] }>;

  /**
   * Turn tray suppression on or off. When on, the native listener dismisses a
   * bank's own notification once it has durably captured the purchase and
   * posted a Covault notification in its place.
   *
   * Prefer the `getHideBankNotifications` / `setHideBankNotifications` helpers
   * below over calling these directly — they tolerate an older APK where the
   * native methods don't exist yet.
   */
  setHideBankNotifications(options: { hidden: boolean }): Promise<void>;
  getHideBankNotifications(): Promise<{ hidden: boolean }>;

  /**
   * Take the destination of a tapped notification and clear it, or '' if the
   * app was opened normally. Use the `consumePendingRoute` helper below.
   */
  consumePendingRoute(): Promise<{ route: string }>;

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
 * Read whether tray suppression is on.
 *
 * SharedPreferences on the native side is the only source of truth: the
 * listener service reads it with the WebView dead, so mirroring it into
 * localStorage would just create a second value that can disagree.
 *
 * Returns false on web, and on an APK built before the native methods
 * existed — a Capacitor plugin proxy happily exposes any method name and only
 * rejects when it's called.
 */
export async function getHideBankNotifications(
  plugin: CovaultNotificationPlugin | null = covaultNotification,
): Promise<boolean> {
  if (!plugin) return false;
  try {
    const { hidden } = await plugin.getHideBankNotifications();
    return hidden === true;
  } catch (e) {
    log.debug('[covaultNotification] getHideBankNotifications unavailable:', e);
    return false;
  }
}

/**
 * Turn tray suppression on or off.
 *
 * Returns the value the native side is now holding, which is what the UI
 * should render. On failure that's the unchanged old value rather than the
 * requested one — showing the toggle as flipped when the native listener
 * never got the message would be worse than showing it as refused.
 */
export async function setHideBankNotifications(
  hidden: boolean,
  plugin: CovaultNotificationPlugin | null = covaultNotification,
): Promise<boolean> {
  if (!plugin) return false;
  try {
    await plugin.setHideBankNotifications({ hidden });
    return hidden;
  } catch (e) {
    log.warn('[covaultNotification] Could not set hide-bank-notifications:', e);
    return getHideBankNotifications(plugin);
  }
}

/** Destinations a tapped notification can ask the app to open. */
export type NotificationRoute = 'review';

/**
 * Take the destination of a tapped notification, if the app was opened by one.
 *
 * Returns null for an ordinary launch, on web, and on an APK built before the
 * native method existed. The native side clears the value as it hands it over,
 * so a route is acted on exactly once — a later launch won't re-navigate.
 */
export async function consumePendingRoute(
  plugin: CovaultNotificationPlugin | null = covaultNotification,
): Promise<NotificationRoute | null> {
  if (!plugin) return null;
  try {
    const { route } = await plugin.consumePendingRoute();
    return route === 'review' ? 'review' : null;
  } catch (e) {
    log.debug('[covaultNotification] consumePendingRoute unavailable:', e);
    return null;
  }
}

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

    if (bankingPackages.length === 0) {
      log.debug('[autoDetect] No known banking apps found installed');
      return;
    }

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
      log.debug(
        `[autoDetect] Saved ${savedSet.size} monitored banking apps (${bankingPackages.length} installed)`,
      );
    }
  } catch (e) {
    log.warn('[autoDetect] Error during banking app auto-detection:', e);
  }
}

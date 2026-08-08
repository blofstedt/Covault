// lib/covaultNotification.ts
import { log } from './log';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { parseCaptureOutcomes, type CaptureOutcome } from './captureOutcome';

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
   * Whether Covault's own capture notification can reach the shade right now.
   * False means tray suppression is being skipped on every capture, however
   * the toggle above is set.
   *
   * Prefer the `canPostCaptureNotifications` helper below.
   */
  getCaptureNotificationStatus(): Promise<{ canPost: boolean }>;

  /** Open Android's notification settings page for Covault. */
  openNotificationSettings(): Promise<void>;

  /**
   * What happened to each of the last few bank alerts, as a JSON array string.
   *
   * Prefer the `getCaptureDiagnostics` helper below, which parses and
   * validates it.
   */
  getCaptureDiagnostics(): Promise<{ entries: string }>;

  /**
   * Take the destination of a tapped notification and clear it, or '' if the
   * app was opened normally. Use the `consumePendingRoute` helper below.
   */
  consumePendingRoute(): Promise<{ route: string }>;

  /**
   * Hand the home-screen widget a fresh snapshot and redraw it. `rules` mirrors
   * the user's vendor→category overrides so the native notification listener
   * can categorise a capture while the app is closed.
   *
   * Prefer the `pushWidgetSnapshot` helper below, which tolerates an older APK.
   */
  updateWidget(options: { snapshot: string; rules: string; autoFile: boolean }): Promise<void>;

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

/**
 * Whether Covault's own capture notification can actually be posted.
 *
 * Tray suppression only dismisses a bank alert once Covault has put its own
 * notification in its place, so when Android is blocking us — POST_NOTIFICATIONS
 * never granted, revoked by a reinstall, or the "Captured transactions" channel
 * set to None — nothing is ever hidden, silently, while capture carries on
 * working. That is the one precondition of the toggle with no symptom of its
 * own, so the settings screen asks about it directly.
 *
 * Returns true when the answer can't be had — on web, and on an APK built
 * before the native method existed. A warning shown on a guess would send the
 * user to fix something that isn't broken; the real answer is never a guess.
 */
export async function canPostCaptureNotifications(
  plugin: CovaultNotificationPlugin | null = covaultNotification,
): Promise<boolean> {
  if (!plugin) return true;
  try {
    const { canPost } = await plugin.getCaptureNotificationStatus();
    return canPost !== false;
  } catch (e) {
    log.debug('[covaultNotification] getCaptureNotificationStatus unavailable:', e);
    return true;
  }
}

/**
 * Send the user to Android's notification settings for Covault.
 *
 * The fallback for when the runtime permission prompt is no longer offered:
 * Android stops showing it after a denial, so the settings page is the only
 * way back.
 */
export async function openNotificationSettings(
  plugin: CovaultNotificationPlugin | null = covaultNotification,
): Promise<void> {
  if (!plugin) return;
  try {
    await plugin.openNotificationSettings();
  } catch (e) {
    log.warn('[covaultNotification] Could not open notification settings:', e);
  }
}

/**
 * What happened to each of the last few bank alerts, newest first.
 *
 * Empty on web, on an APK built before the native method existed, and when
 * nothing has been captured yet — all three mean "nothing to show", which is
 * what the settings screen does with them.
 */
export async function getCaptureDiagnostics(
  plugin: CovaultNotificationPlugin | null = covaultNotification,
): Promise<CaptureOutcome[]> {
  if (!plugin) return [];
  try {
    const { entries } = await plugin.getCaptureDiagnostics();
    return parseCaptureOutcomes(entries);
  } catch (e) {
    log.debug('[covaultNotification] getCaptureDiagnostics unavailable:', e);
    return [];
  }
}

/**
 * Destinations a tapped notification or widget can ask the app to open.
 *
 * `review` comes from a capture notification or the widget's review pill.
 * `{ budget }` comes from tapping a category row on the widget.
 */
export type NotificationRoute = 'review' | { budget: string };

/** "budget:Groceries" — mirrors ROUTE_BUDGET_PREFIX in NotificationListener.java. */
const BUDGET_ROUTE_PREFIX = 'budget:';

/**
 * Read a parked destination string, or null if it isn't one we know.
 *
 * Unknown values are dropped rather than guessed at: a route this build has
 * never heard of would otherwise navigate the user somewhere arbitrary.
 */
export function parseNotificationRoute(raw: unknown): NotificationRoute | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value === 'review') return 'review';
  if (value.startsWith(BUDGET_ROUTE_PREFIX)) {
    const budget = value.slice(BUDGET_ROUTE_PREFIX.length).trim();
    return budget ? { budget } : null;
  }
  return null;
}

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
    return parseNotificationRoute(route);
  } catch (e) {
    log.debug('[covaultNotification] consumePendingRoute unavailable:', e);
    return null;
  }
}

/** A vendor→category rule, flattened for the native matcher. */
export interface WidgetVendorRule {
  matchKey: string;
  matchType: string;
  category: string;
}

/**
 * Push a widget snapshot to native storage and trigger a redraw.
 *
 * Silent on web and on an APK built before the native method existed — the
 * widget simply isn't there to update, and a failure here must never be
 * allowed to look like an app error.
 */
export async function pushWidgetSnapshot(
  snapshot: unknown,
  rules: WidgetVendorRule[],
  /**
   * Mirrored so the native listener can tell whether a capture made with the
   * app closed will be auto-filed or will wait in Review — which decides
   * whether it bumps the widget's review badge.
   */
  autoFile: boolean,
  plugin: CovaultNotificationPlugin | null = covaultNotification,
): Promise<void> {
  if (!plugin) return;
  try {
    await plugin.updateWidget({
      snapshot: JSON.stringify(snapshot),
      rules: JSON.stringify(rules),
      autoFile,
    });
  } catch (e) {
    log.debug('[covaultNotification] updateWidget unavailable:', e);
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

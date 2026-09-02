// lib/covaultNotification.ts
import { log } from './log';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { parseCaptureOutcomes, type CaptureOutcome } from './captureOutcome';
import { getSelectedSources, hasChosenSources, setSelectedSources } from './captureSources';

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

  /**
   * Android id of the "$X at Y — captured" notification the native listener
   * posted for this alert.
   *
   * The listener has to post before anything has classified the alert — it is
   * the only part of Covault running when the app is closed. This is the
   * handle for undoing that: when the pipeline decides the alert was not an
   * expense, `cancelCaptureNotification` takes it back down.
   *
   * Absent on an APK built before the native side sent it, in which case the
   * notification simply stays as it did before.
   */
  capture_notification_id?: number;

  /**
   * Which route this alert arrived by — a bank's own app, or an email.
   *
   * Absent on an APK built before email was a source, which is read as 'bank':
   * that is what every capture was before this existed, and it is the safe
   * reading, since the email-specific rules only ever ADD restrictions.
   */
  channel?: 'bank' | 'email';

  /**
   * Notification title and body, kept apart.
   *
   * For a mail app the title is the SENDER, which is the one thing the pipeline
   * has to vet before reading anything else. The concatenated `raw_text` cannot
   * be split back apart reliably, so the two halves are carried separately.
   * Absent on an older APK.
   */
  title?: string;
  body?: string;
}

export interface CovaultNotificationPlugin {
  // You already have methods like these in your other repo:
  /**
   * Open the notification-access page.
   *
   * `hint`, when given, is shown as a Toast on the way out — the only text an
   * app can put in front of someone who is about to be looking at Android's
   * Settings rather than at Covault. Optional so an APK built before the hint
   * existed still opens the page, silently.
   */
  requestAccess(options?: { hint?: string }): Promise<void>;
  isEnabled(): Promise<{ enabled: boolean }>;
  getInstalledApps(): Promise<{ apps: Array<{ packageName: string; name: string }> }>;
  /**
   * Replace the list of apps the listener may read.
   *
   * `chosen` marks the list as the user's own answer rather than a seeded
   * default, which is what makes unticking an app stick. It defaults to true on
   * the native side, so an older APK that has never heard of it behaves exactly
   * as it always did. Pass false only when seeding.
   */
  saveMonitoredApps(options: { apps: any; chosen?: boolean }): Promise<void>;
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

  /**
   * Open ANOTHER app's Android notification settings — a bank's.
   *
   * Prefer the `openAppNotificationSettings` helper below, which tolerates an
   * APK built before this method existed.
   */
  openAppNotificationSettings(options: { packageName: string }): Promise<void>;

  /**
   * Take down the capture notification with this id. Used when the pipeline
   * concludes the alert it announced was not an expense.
   *
   * Prefer the `cancelCaptureNotification` helper below.
   */
  cancelCaptureNotification(options: { id: number }): Promise<void>;

  /**
   * Mirror the user's "not a transaction" rules into native storage so the
   * listener can stay silent about them with the app closed.
   *
   * Prefer the `pushSkipRules` helper below.
   */
  setSkipRules(options: { rules: string }): Promise<void>;

  /**
   * Mirror the charges the app is already expecting — the user's recurring
   * transactions — into native storage, so the listener does not announce a
   * subscription Covault has had on the books for months.
   *
   * Prefer the `pushRecurringCharges` helper below.
   */
  setRecurringCharges(options: { charges: string }): Promise<void>;

  /** Open Android's notification settings page for Covault. */
  openNotificationSettings(): Promise<void>;

  /**
   * Open Covault's App info page — the one with the overflow menu holding
   * "Allow restricted settings".
   *
   * Prefer the `openAppInfo` helper below.
   */
  /** Opens the App info page; `hint` is shown as a Toast on the way out. */
  openAppInfo(options?: { hint?: string }): Promise<void>;

  /**
   * Whether Android's restricted-settings block applies to this install, and
   * so whether the setup flow needs to mention it.
   *
   * Prefer the `restrictedSettingsApply` helper below.
   */
  getRestrictedSettingsInfo(): Promise<{ applies: boolean; installer: string }>;

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
 * Withdraw the capture notification that announced an alert which turned out
 * not to be an expense.
 *
 * The listener posts the moment a bank alert arrives, because with the app
 * closed that is the only way capture is immediate — but it posts on the
 * strength of a dollar amount and nothing else. Anything the pipeline then
 * rejects has a notification standing behind it promising a purchase that will
 * never appear in Review, and this is what clears it.
 *
 * Silent on web, when the event carried no id, and on an APK built before the
 * native method existed. In all three the notification just stays, which is
 * what happened before this existed.
 */
export async function cancelCaptureNotification(
  id: number | null | undefined,
  plugin: CovaultNotificationPlugin | null = covaultNotification,
): Promise<void> {
  if (!plugin) return;
  if (typeof id !== 'number' || !Number.isFinite(id)) return;
  try {
    await plugin.cancelCaptureNotification({ id });
  } catch (e) {
    log.debug('[covaultNotification] cancelCaptureNotification unavailable:', e);
  }
}

/** One "not a transaction" rule, in the shape the native matcher reads. */
export interface SkipRule {
  pattern: string;
  pattern_type: string;
}

/**
 * Hand the native listener the user's current "not a transaction" rules.
 *
 * The rules live in the database, but the listener runs with the WebView dead
 * and no network — so without a local copy an alert the user has already
 * marked as noise keeps posting a capture notification every time it arrives.
 *
 * Silent on web and on an older APK: the web pipeline still applies the rules,
 * so the only thing lost is the silence.
 */
export async function pushSkipRules(
  rules: SkipRule[],
  plugin: CovaultNotificationPlugin | null = covaultNotification,
): Promise<void> {
  if (!plugin) return;
  try {
    await plugin.setSkipRules({
      rules: JSON.stringify(
        rules
          .filter((rule) => !!rule && typeof rule.pattern === 'string' && rule.pattern.trim() !== '')
          .map((rule) => ({
            pattern: rule.pattern,
            pattern_type: rule.pattern_type === 'contains' ? 'contains' : 'exact',
          })),
      ),
    });
  } catch (e) {
    log.debug('[covaultNotification] setSkipRules unavailable:', e);
  }
}

/** One subscription the listener should stay quiet about. */
export interface RecurringChargeHint {
  vendor: string;
  amount: number;
}

/**
 * Hand the native listener the charges the app is already expecting.
 *
 * A subscription is announced twice: once by the bank, and once by Covault's
 * own recurring machinery, which has had it on the books for months. The web
 * pipeline knows to ignore the bank's copy — but the "$X at Y — captured"
 * notification is posted by a service that runs with the WebView dead, long
 * before that pipeline gets a look, so without this list the user is still
 * told about money they already accounted for.
 *
 * A match here only skips the notification. The alert is still captured and
 * still handed to the pipeline, which remains the sole authority on what
 * reaches the ledger — so a wrong entry in this list costs a notice, never a
 * purchase. It also leaves tray suppression off for that alert, so the bank's
 * own notification stays in the shade.
 *
 * Silent on web and on an APK built before the native method existed, where the
 * notification is instead withdrawn a moment later by the pipeline.
 */
export async function pushRecurringCharges(
  charges: RecurringChargeHint[],
  plugin: CovaultNotificationPlugin | null = covaultNotification,
): Promise<void> {
  if (!plugin) return;
  try {
    await plugin.setRecurringCharges({
      charges: JSON.stringify(
        (charges || [])
          .filter(
            (charge) =>
              !!charge &&
              typeof charge.vendor === 'string' &&
              charge.vendor.trim() !== '' &&
              Number.isFinite(charge.amount) &&
              charge.amount > 0,
          )
          .map((charge) => ({
            vendor: charge.vendor.trim(),
            amount: Number(charge.amount),
          })),
      ),
    });
  } catch (e) {
    log.debug('[covaultNotification] setRecurringCharges unavailable:', e);
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
 * Send the user to a BANK's notification settings page.
 *
 * The repair offered next to "we have heard nothing from this bank": if its
 * notifications are switched off in Android, this is the screen that turns
 * them back on. Returns false when the trip could not be made — an older APK
 * without the native method, or the web build — so the caller can fall back to
 * saying where to go by hand rather than leaving a button that does nothing.
 */
export async function openAppNotificationSettings(
  packageName: string,
  plugin: CovaultNotificationPlugin | null = covaultNotification,
): Promise<boolean> {
  if (!plugin || !packageName) return false;
  try {
    await plugin.openAppNotificationSettings({ packageName });
    return true;
  } catch (e) {
    log.warn('[covaultNotification] Could not open notification settings for', packageName, e);
    return false;
  }
}

/**
 * Send the user to Covault's App info page.
 *
 * This is the screen with the ⋮ menu that holds "Allow restricted settings" —
 * the gate Android 13 puts in front of notification access for any app that
 * didn't come from a store. Nothing on the notification-access page itself
 * says so; the toggle simply refuses to move.
 */
export async function openAppInfo(
  plugin: CovaultNotificationPlugin | null = covaultNotification,
  hint?: string,
): Promise<void> {
  if (!plugin) return;
  try {
    await plugin.openAppInfo({ hint });
  } catch (e) {
    log.warn('[covaultNotification] Could not open app info:', e);
  }
}

/**
 * Whether the setup flow should include the restricted-settings step.
 *
 * False on web, on Android 12 and below, when the app came from a store, and
 * on an APK built before the native method existed. That last one is the
 * reason for the default: an older build can't answer, and a step the user
 * doesn't need is a smaller failure than a step they can't find, so it stays
 * false only where the answer is a real "no".
 */
export async function restrictedSettingsApply(
  plugin: CovaultNotificationPlugin | null = covaultNotification,
): Promise<boolean> {
  if (!plugin) return false;
  try {
    const { applies } = await plugin.getRestrictedSettingsInfo();
    return applies === true;
  } catch (e) {
    log.debug('[covaultNotification] getRestrictedSettingsInfo unavailable:', e);
    return false;
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
 * SEEDING ONLY. This runs on every launch and is add-only, so before the guard
 * below it would put back every bank the user had just switched off, every time
 * they opened the app — deselection would appear to work and silently undo
 * itself. Once the user has answered, their list is the answer, and this does
 * nothing at all.
 *
 * The write passes `chosen: false` for the same reason: seeding a sensible
 * default is not the user making a choice, and marking it as one would freeze
 * the list before they had ever seen the picker.
 */
export async function autoDetectAndSaveMonitoredApps(
  knownBankingApps: Record<string, string>,
): Promise<void> {
  if (!covaultNotification) return;
  if (hasChosenSources()) {
    log.debug('[autoDetect] The user has chosen their capture sources; leaving the list alone');
    return;
  }

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
      await covaultNotification.saveMonitoredApps({ apps: Array.from(savedSet), chosen: false });
      log.debug(
        `[autoDetect] Saved ${savedSet.size} monitored banking apps (${bankingPackages.length} installed)`,
      );
    }
  } catch (e) {
    log.warn('[autoDetect] Error during banking app auto-detection:', e);
  }
}

/**
 * Record the user's choice of capture sources — in BOTH places, together.
 *
 * There are two lists and they have to agree. The native `monitored_apps` list
 * decides what is forwarded off the phone at all; the web-side selection decides
 * what is accepted when it arrives. Writing only one produces a silent
 * half-state that is very hard to diagnose from the outside: with only the
 * native list, notifications are read and then thrown away, so nothing is ever
 * saved and nothing says why; with only the web list, the app is willing to
 * accept alerts that never reach it.
 *
 * That has happened before, which is why every caller now goes through this one
 * function rather than remembering to make two calls.
 *
 * The web list is written FIRST and on every platform. It is the one that
 * survives the app being reinstalled from a web bundle, and on a phone with an
 * older APK — which has no idea about any of this — it is the only one there is.
 */
export async function applySourceSelection(packages: string[]): Promise<void> {
  setSelectedSources(packages);
  if (!covaultNotification) return;

  try {
    // Read back rather than passing `packages` through: getSelectedSources has
    // already folded case and dropped excluded apps, and the two sides must be
    // given byte-identical lists or they will disagree about a mixed-case
    // package name.
    await covaultNotification.saveMonitoredApps({
      apps: getSelectedSources(),
      chosen: true,
    });
  } catch (e) {
    log.warn('[captureSources] Could not push the selection to the listener:', e);
  }
}

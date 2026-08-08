// components/dashboard_components/settings_modal_components/NotificationSettingsSection.tsx
import { log } from '../../../lib/log';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import SettingsCard from '../../ui/SettingsCard';
import SectionHeader from '../../ui/SectionHeader';
import ToggleSwitch from '../../ui/ToggleSwitch';
import { getBankingApps } from '../../../lib/bankingApps';
import type { CovaultNotificationPlugin } from '../../../lib/covaultNotification';
import {
  getHideBankNotifications,
  setHideBankNotifications,
  canPostCaptureNotifications,
  openNotificationSettings,
  getCaptureDiagnostics,
} from '../../../lib/covaultNotification';
import { requestPostNotifications } from '../../../lib/appNotifications';
import {
  captureOutcomeAdvice,
  captureOutcomeAppName,
  captureOutcomeLabel,
  captureProblemHeadline,
  describeCaptureOutcome,
  isCaptureProblem,
  type CaptureOutcome,
  type CaptureOutcomeCode,
} from '../../../lib/captureOutcome';


interface NotificationSettingsSectionProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  /** File captures straight into a budget when a learned rule confidently matches. */
  autoAcceptKnownVendors?: boolean;
  onToggleAutoAccept?: () => void;
  /** Light vibration when a capture is filed or deleted. */
  hapticsEnabled?: boolean;
  onToggleHaptics?: () => void;
}

const NotificationSettingsSection: React.FC<NotificationSettingsSectionProps> = ({
  enabled,
  onToggle,
  autoAcceptKnownVendors = false,
  onToggleAutoAccept,
  hapticsEnabled = true,
  onToggleHaptics,
}) => {
  const isNative = Capacitor.isNativePlatform();
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [installedBankApps, setInstalledBankApps] = useState<
    Array<{ packageName: string; name: string }>
  >([]);
  const [selectedApps, setSelectedApps] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [plugin, setPlugin] = useState<CovaultNotificationPlugin | null>(null);
  // Tray suppression. Device-local, so the native SharedPreferences value is
  // the only source of truth — this is a mirror of it for rendering, never a
  // second place the preference lives.
  const [hideBankNotifs, setHideBankNotifs] = useState(false);
  const [savingHideBankNotifs, setSavingHideBankNotifs] = useState(false);
  // Whether Android will let Covault post its own capture notification. When
  // it won't, the toggle above does nothing at all — a bank alert is only ever
  // dismissed once Covault has replaced it — so this is shown rather than left
  // for the user to work out from a tray that never empties. Assumed fine
  // until the native side says otherwise, so an older APK raises no alarm.
  const [captureNotifsAllowed, setCaptureNotifsAllowed] = useState(true);
  const [fixingCaptureNotifs, setFixingCaptureNotifs] = useState(false);
  // What actually happened to the last few bank alerts. Newest first.
  const [captureOutcomes, setCaptureOutcomes] = useState<CaptureOutcome[]>([]);

  // Initialize plugin
  useEffect(() => {
    if (!isNative) return;
    try {
      const p = registerPlugin<CovaultNotificationPlugin>('CovaultNotification');
      setPlugin(p);
    } catch {
      // Plugin not available
    }
  }, [isNative]);

  // Check permission status and load data.
  // Always scan for installed banking apps so the user can see which
  // apps are detected — even before granting notification permission.
  const checkStatus = useCallback(async () => {
    if (!plugin) return;
    try {
      setLoading(true);
      const { enabled: granted } = await plugin.isEnabled();
      setPermissionGranted(granted);

      // Always scan for installed banking apps regardless of permission
      // so the user can see their apps are detected on this device.
      const { apps: installed } = await plugin.getInstalledApps();
      const bankingApps = getBankingApps();
      const bankApps = installed.filter((a) => a.packageName in bankingApps);

      const named = bankApps
        .map((a) => ({
          packageName: a.packageName,
          name: bankingApps[a.packageName] || a.name,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      setInstalledBankApps(named);

      setHideBankNotifs(await getHideBankNotifications(plugin));
      setCaptureNotifsAllowed(await canPostCaptureNotifications(plugin));
      setCaptureOutcomes(await getCaptureDiagnostics(plugin));

      if (granted) {
        const { apps: saved } = await plugin.getMonitoredApps();
        if (saved && saved.length > 0) {
          setSelectedApps(new Set(saved));
        } else {
          // Default: select all banking apps found and persist so the
          // native NotificationListener can monitor them immediately.
          const allPkgs = named.map((a) => a.packageName);
          setSelectedApps(new Set(allPkgs));
          if (allPkgs.length > 0) {
            await plugin.saveMonitoredApps({ apps: allPkgs });
          }
        }
      } else {
        setSelectedApps(new Set());
      }
    } catch (e) {
      log.warn('[NotificationSettingsSection] checkStatus error:', e);
    } finally {
      setLoading(false);
    }
  }, [plugin]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  // Re-check when app resumes
  useEffect(() => {
    if (!isNative) return;
    const onResume = () => {
      checkStatus();
    };
    document.addEventListener('resume', onResume);
    return () => document.removeEventListener('resume', onResume);
  }, [isNative, checkStatus]);

  // Poll after requesting access
  const pollCancelledRef = useRef(false);
  const pollForPermission = useCallback(async () => {
    if (!plugin) return;
    pollCancelledRef.current = false;
    for (let i = 0; i < 20; i++) {
      if (pollCancelledRef.current) return;
      await new Promise((r) => setTimeout(r, 2000));
      if (pollCancelledRef.current) return;
      try {
        const { enabled: granted } = await plugin.isEnabled();
        if (granted) {
          if (pollCancelledRef.current) return;
          setPermissionGranted(true);
          onToggle(true);
          // Reading other apps' notifications and posting our own are two
          // different permissions, and only the first one was ever asked for.
          // Capture posts a notification of its own, and hiding the bank's
          // alert depends on that notification existing — so ask for it at the
          // moment capture is switched on rather than leaving it to whichever
          // budget alert happens to fire first.
          await requestPostNotifications();
          checkStatus();
          return;
        }
      } catch {
        // ignore
      }
    }
  }, [plugin, checkStatus]);

  useEffect(() => {
    return () => { pollCancelledRef.current = true; };
  }, []);

  const handleToggle = async () => {
    if (!isNative || !plugin) return;

    if (enabled) {
      // Logical off (we still can't revoke OS permission from here)
      onToggle(false);
      return;
    }

    // Turning on — open Android notification listener settings
    // Don't set enabled yet; wait for permission to be confirmed
    try {
      await plugin.requestAccess();
      pollForPermission();
    } catch (e) {
      log.error('[NotificationSettingsSection] handleToggle error:', e);
    }
  };

  const toggleApp = async (pkg: string) => {
    const next = new Set(selectedApps);
    if (next.has(pkg)) {
      next.delete(pkg);
    } else {
      next.add(pkg);
    }
    setSelectedApps(next);

    if (plugin) {
      try {
        await plugin.saveMonitoredApps({ apps: Array.from(next) });
      } catch (e) {
        log.warn('[NotificationSettingsSection] save error:', e);
      }
    }
  };

  const selectAll = async () => {
    const all = new Set(installedBankApps.map((a) => a.packageName));
    setSelectedApps(all);
    if (plugin) {
      try {
        await plugin.saveMonitoredApps({ apps: Array.from(all) });
      } catch {
        // ignore
      }
    }
  };

  // Deliberately not optimistic: the toggle only moves once the native side
  // confirms it stored the new value. A toggle that looks on while the
  // listener still thinks it's off is exactly the kind of disagreement that
  // makes this feature scary.
  const toggleHideBankNotifs = async () => {
    if (!plugin || savingHideBankNotifs) return;
    setSavingHideBankNotifs(true);
    try {
      setHideBankNotifs(await setHideBankNotifications(!hideBankNotifs, plugin));
    } finally {
      setSavingHideBankNotifs(false);
    }
  };

  // Two routes, tried in order, because Android offers the prompt only once
  // ever: ask outright, and if permission still isn't there — already denied,
  // or it's the channel rather than the app that's switched off — hand the
  // user to the settings page, which is the only remaining way through.
  const fixCaptureNotifs = async () => {
    if (fixingCaptureNotifs) return;
    setFixingCaptureNotifs(true);
    try {
      await requestPostNotifications();
      const allowed = await canPostCaptureNotifications(plugin);
      setCaptureNotifsAllowed(allowed);
      if (!allowed) await openNotificationSettings(plugin);
    } finally {
      setFixingCaptureNotifs(false);
    }
  };

  const selectNone = async () => {
    setSelectedApps(new Set());
    if (plugin) {
      try {
        await plugin.saveMonitoredApps({ apps: [] });
      } catch {
        // ignore
      }
    }
  };

  // Browser-only info block - now with toggle
  if (!isNative) {
    return (
      <SettingsCard id="settings-notifications-container" className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex-1 mr-3">
            <SectionHeader title="Bank Notification Listener" subtitle="Auto-log transactions from supported banking apps." />
            
            {/* Info message for browser */}
            <div className="mt-2">
              <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700">
                <span className="w-2 h-2 rounded-full bg-slate-400 mr-2" />
                <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                  Available on Android app only
                </span>
              </span>
            </div>
          </div>

          {/* Disabled toggle for browser */}
          <ToggleSwitch enabled={false} onToggle={() => {}} disabled />
        </div>
        
        <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-tight">
          Install the Covault Android app and enable notification access to auto-log your banking transactions.
        </p>
      </SettingsCard>
    );
  }

  const autoAddActive =
    enabled && permissionGranted && selectedApps.size > 0 && installedBankApps.length > 0;

  // Why alerts aren't being hidden, or null when nothing is wrong.
  //
  // The live permission check wins over the recorded history: it is the state
  // right now, the history is what happened last time. They agree in the
  // ordinary case, and when they don't it is because the user has just fixed
  // it — in which case telling them about the alert that failed before the fix
  // would be wrong.
  const trayProblem: CaptureOutcomeCode | null = !captureNotifsAllowed
    ? 'blocked'
    : captureOutcomes.find((entry) => isCaptureProblem(entry.outcome))?.outcome ?? null;

  return (
    <SettingsCard id="settings-notifications-container" className="space-y-4">
      {/* TOGGLE + STATUS */}
      <div className="flex items-center justify-between">
        <div className="flex-1 mr-3">
          <SectionHeader title="Bank Notification Listener" subtitle="Auto-log transactions from supported banking apps." />

          {/* STATUS PILL */}
          <div className="mt-2">
            {autoAddActive && (
              <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700">
                <span className="w-2 h-2 rounded-full bg-emerald-500 mr-2" />
                <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                  Auto-adding from {selectedApps.size} app
                  {selectedApps.size === 1 ? '' : 's'}
                </span>
              </span>
            )}

            {!permissionGranted && enabled && (
              <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700">
                <span className="w-2 h-2 rounded-full bg-amber-500 mr-2" />
                <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                  Permission not granted in system settings
                </span>
              </span>
            )}

            {enabled && permissionGranted && selectedApps.size === 0 && (
              <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700">
                <span className="w-2 h-2 rounded-full bg-slate-400 mr-2" />
                <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                  No banking apps selected
                </span>
              </span>
            )}

            {!permissionGranted && enabled && (
              <button
                type="button"
                onClick={() => {
                  // Re-open the system settings page so the user can finish
                  // granting the special "Notification access" permission.
                  plugin?.requestAccess();
                }}
                className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 text-[10px] font-semibold text-amber-800 dark:text-amber-200 active:scale-[0.97] transition-transform"
              >
                Open settings →
              </button>
            )}

            {!enabled && installedBankApps.length > 0 && (
              <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700">
                <span className="w-2 h-2 rounded-full bg-blue-500 mr-2" />
                <span className="text-[10px] font-semibold text-blue-700 dark:text-blue-300">
                  {installedBankApps.length} banking app{installedBankApps.length === 1 ? '' : 's'} detected
                </span>
              </span>
            )}
          </div>
        </div>

        <ToggleSwitch enabled={enabled} onToggle={handleToggle} />
      </div>

      {/* Step-by-step help when the special "Notification access" permission
          isn't granted yet. Android routes this through Settings > Apps >
          Special app access, which is buried and easy to miss — so we
          surface the exact steps in-app. */}
      {isNative && !permissionGranted && (
        <details
          className="rounded-2xl border border-amber-200/70 dark:border-amber-800/40 bg-amber-50/60 dark:bg-amber-950/20 px-3 py-2"
          data-testid="notification-permission-help"
        >
          <summary className="cursor-pointer text-[11px] font-semibold text-amber-800 dark:text-amber-300 select-none">
            How to grant notification access
          </summary>
          <ol className="mt-2 space-y-1.5 text-[10px] leading-relaxed text-amber-900/80 dark:text-amber-200/80 list-decimal pl-4">
            <li>Tap <span className="font-semibold">Open settings</span> above (or the toggle) — Android opens <span className="font-semibold">Settings &gt; Apps &gt; Special app access &gt; Notification access</span>.</li>
            <li>Find <span className="font-semibold">Covault</span> in the list and tap it.</li>
            <li>Toggle <span className="font-semibold">Allow notification access</span> on, then confirm <span className="font-semibold">Allow</span> on the system dialog.</li>
            <li>Come back to Covault — the status pill will turn green automatically (no need to reopen this screen).</li>
          </ol>
          <p className="mt-2 text-[10px] text-amber-700/80 dark:text-amber-300/70">
            This is a one-time setup. The system requirement exists so apps can't read your notifications without your explicit consent.
          </p>
        </details>
      )}

      {/* Auto-accept known vendors */}
      {enabled && permissionGranted && onToggleAutoAccept && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700/50 bg-slate-50/60 dark:bg-slate-800/30 px-3 py-3">
          <div className="flex items-center justify-between">
            <div className="flex-1 mr-3">
              <SectionHeader
                title="Auto-file known vendors"
                subtitle="Skip review when a learned rule matches."
              />
            </div>
            <ToggleSwitch enabled={autoAcceptKnownVendors} onToggle={onToggleAutoAccept} />
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
            {autoAcceptKnownVendors
              ? 'Captures that match one of your learned rules with 90%+ certainty are renamed to that vendor and filed to its budget without appearing in Review. Only rules you created count — an AI guess always waits for you. Everything filed this way is still in your history and budgets, and shows a notification when it lands.'
              : 'When on, a capture that matches one of your learned rules with 90%+ certainty is renamed to that vendor and filed straight to its budget, skipping Review. Anything less certain still waits for you.'}
          </p>
        </div>
      )}

      {/* Haptics */}
      {isNative && onToggleHaptics && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700/50 bg-slate-50/60 dark:bg-slate-800/30 px-3 py-3">
          <div className="flex items-center justify-between">
            <div className="flex-1 mr-3">
              <SectionHeader
                title="Vibration"
                subtitle="A light tap when something is filed."
              />
            </div>
            <ToggleSwitch enabled={hapticsEnabled} onToggle={onToggleHaptics} />
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
            Only on deliberate actions — accepting a transaction, or deleting one. Never while scrolling or moving between screens. Turned off automatically if your device is set to reduce motion.
          </p>
        </div>
      )}

      {/* Tray suppression */}
      {enabled && permissionGranted && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700/50 bg-slate-50/60 dark:bg-slate-800/30 px-3 py-3">
          <div className="flex items-center justify-between">
            <div className="flex-1 mr-3">
              <SectionHeader
                title="Hide bank alerts after capture"
                subtitle="Show one Covault notification instead of two."
              />
            </div>
            <ToggleSwitch
              enabled={hideBankNotifs}
              onToggle={toggleHideBankNotifs}
              disabled={savingHideBankNotifs}
            />
          </div>

          {/* Why an alert is still in the tray.
              Suppression has six ways to decline and every one of them looks
              identical from the outside — the alert simply stays. The listener
              writes down which it was for each alert; this reads it back, so
              the answer is on screen instead of in a log nobody can reach. */}
          {hideBankNotifs && trayProblem && (
            <div
              className="mt-3 rounded-2xl border border-amber-200 dark:border-amber-800/50 bg-amber-50/70 dark:bg-amber-950/25 px-3 py-2.5"
              data-testid="tray-suppression-problem"
            >
              <div className="flex items-center">
                <span className="w-2 h-2 rounded-full bg-amber-500 mr-2 flex-shrink-0" />
                <span className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                  {captureProblemHeadline(trayProblem)}
                </span>
              </div>
              <p className="mt-1.5 text-[10px] leading-relaxed text-amber-900/80 dark:text-amber-200/80">
                {captureOutcomeAdvice(trayProblem) ??
                  'Your purchases are still being captured — they are waiting in Review.'}
              </p>
              {trayProblem === 'blocked' && (
                <button
                  type="button"
                  onClick={fixCaptureNotifs}
                  disabled={fixingCaptureNotifs}
                  className={`mt-2 inline-flex items-center px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 text-[10px] font-semibold text-amber-800 dark:text-amber-200 transition-transform ${
                    fixingCaptureNotifs ? 'opacity-50' : 'active:scale-[0.97]'
                  }`}
                >
                  Allow notifications →
                </button>
              )}

              {captureOutcomes.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer select-none text-[10px] font-semibold text-amber-800/90 dark:text-amber-300/90">
                    Recent bank alerts
                  </summary>
                  <ul className="mt-1.5 space-y-1">
                    {captureOutcomes.map((entry) => (
                      <li
                        key={`${entry.at}-${entry.app}`}
                        className="flex items-baseline justify-between gap-2 text-[10px] leading-relaxed"
                      >
                        <span className="text-amber-900/80 dark:text-amber-200/80">
                          {captureOutcomeAppName(entry.app)}
                          {entry.amount !== null && ` · $${entry.amount.toFixed(2)}`}
                        </span>
                        <span
                          className={`flex-shrink-0 font-semibold ${
                            entry.outcome === 'hidden'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-amber-800 dark:text-amber-300'
                          }`}
                          title={describeCaptureOutcome(entry.outcome)}
                        >
                          {captureOutcomeLabel(entry.outcome)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          <p className="mt-2 text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
            {hideBankNotifs
              ? 'Covault dismisses a bank alert only after it has saved the purchase and posted its own notification. If either step fails — or you have turned Covault notifications off in Android settings — the bank alert is left alone. Alerts already in your tray are never touched.'
              : 'When on, a bank alert is dismissed from your tray once Covault has captured the purchase and replaced it with its own notification. Nothing is dismissed until the purchase is saved.'}
          </p>
        </div>
      )}

      {/* Banking app picker */}
      {enabled && permissionGranted && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 tracking-wide">
              Your Banking Apps ({installedBankApps.length} found)
            </span>
            <div className="flex space-x-2">
              <button
                onClick={selectAll}
                className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400"
              >
                All
              </button>
              <button
                onClick={selectNone}
                className="text-[10px] font-semibold text-slate-400"
              >
                None
              </button>
            </div>
          </div>

          {installedBankApps.length === 0 ? (
            loading ? (
              <p className="text-[11px] text-slate-400 text-center py-3">
                Detecting installed banking apps…
              </p>
            ) : (
              <p className="text-[11px] text-slate-400 text-center py-3">
                No supported banking apps detected. If you have banking apps installed, they may not be in our supported list yet.
              </p>
            )
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {installedBankApps.map((app) => {
                const selected = selectedApps.has(app.packageName);
                return (
                  <button
                    key={app.packageName}
                    onClick={() => toggleApp(app.packageName)}
                    className={`flex items-center space-x-2 px-3 py-2.5 rounded-xl text-left transition-all duration-200 active:scale-[0.97] border ${
                      selected
                        ? 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-300 dark:border-emerald-700/50'
                        : 'bg-slate-100 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/30'
                    }`}
                  >
                    <span
                      className={`w-4 h-4 rounded-md flex items-center justify-center flex-shrink-0 ${
                        selected ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
                      }`}
                    >
                      {selected && (
                        <svg
                          className="w-3 h-3 text-white"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          strokeWidth={3}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M4.5 12.75l6 6 9-13.5"
                          />
                        </svg>
                      )}
                    </span>
                    <span
                      className={`text-[11px] font-bold truncate ${
                        selected
                          ? 'text-emerald-700 dark:text-emerald-300'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {app.name}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center leading-tight">
            Covault reads notifications from selected apps to auto-log your transactions.
          </p>
        </div>
      )}
    </SettingsCard>
  );
};

export default NotificationSettingsSection;

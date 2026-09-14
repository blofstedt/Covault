import { log } from '../lib/log';
import React, { useState, useEffect, useCallback } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import SettingsCard from './ui/SettingsCard';
import ToggleSwitch from './ui/ToggleSwitch';
import NotificationAccessGuide from './NotificationAccessGuide';
import { clearSetupPending, markSetupPending } from '../lib/notificationAccessSetup';
import {
  getBankingApps,
} from '../lib/bankingApps';
import type { CovaultNotificationPlugin } from '../lib/covaultNotification';

interface NotificationSettingsProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

const NotificationSettings: React.FC<NotificationSettingsProps> = ({ enabled, onToggle }) => {
  const isNative = Capacitor.isNativePlatform();
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [installedBankApps, setInstalledBankApps] = useState<Array<{ packageName: string; name: string }>>([]);
  const [selectedApps, setSelectedApps] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [plugin, setPlugin] = useState<CovaultNotificationPlugin | null>(null);

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

  // Check permission status and load data when component mounts or becomes visible.
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
      const bankApps = installed.filter(a => a.packageName in bankingApps);
      // Use our friendly names
      const named = bankApps.map(a => ({
        packageName: a.packageName,
        name: bankingApps[a.packageName] || a.name,
      }));
      named.sort((a, b) => a.name.localeCompare(b.name));
      setInstalledBankApps(named);

      if (granted) {
        // Load previously saved selections
        const { apps: saved } = await plugin.getMonitoredApps();
        if (saved && saved.length > 0) {
          setSelectedApps(new Set(saved));
        } else {
          // Default: select all banking apps found and persist so the
          // native NotificationListener can monitor them immediately.
          const allPkgs = named.map(a => a.packageName);
          setSelectedApps(new Set(allPkgs));
          if (allPkgs.length > 0) {
            await plugin.saveMonitoredApps({ apps: allPkgs });
          }
        }
      }
    } catch (e) {
      log.warn('[NotificationSettings] checkStatus error:', e);
    } finally {
      setLoading(false);
    }
  }, [plugin]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  // Re-check when app resumes (user returns from Android settings)
  useEffect(() => {
    if (!isNative) return;
    const onResume = () => { checkStatus(); };
    document.addEventListener('resume', onResume);
    return () => document.removeEventListener('resume', onResume);
  }, [isNative, checkStatus]);

  // The setup steps, shown whenever capture is meant to be on and Android
  // hasn't granted access. Latched so the card can show the user finishing
  // rather than disappearing part-way through.
  const [guideOpen, setGuideOpen] = useState(false);
  useEffect(() => {
    if (!loading && enabled && !permissionGranted) setGuideOpen(true);
  }, [loading, enabled, permissionGranted]);

  const handleGuideGranted = useCallback(() => {
    setPermissionGranted(true);
    onToggle(true);
    checkStatus();
  }, [onToggle, checkStatus]);

  const handleToggle = async () => {
    if (!isNative || !plugin) return;

    if (enabled) {
      // A pending setup is cancelled with the switch, or the next launch would
      // turn capture back on the moment Android reported access granted.
      clearSetupPending();
      setGuideOpen(false);
      onToggle(false);
      return;
    }

    if (permissionGranted) {
      onToggle(true);
      return;
    }

    // Three permissions in a fixed order, so the toggle opens the steps rather
    // than dropping the user on a system page whose switch may refuse to move.
    markSetupPending();
    setGuideOpen(true);
  };

  const toggleApp = async (pkg: string) => {
    const next = new Set(selectedApps);
    if (next.has(pkg)) {
      next.delete(pkg);
    } else {
      next.add(pkg);
    }
    setSelectedApps(next);

    // Persist
    if (plugin) {
      try {
        await plugin.saveMonitoredApps({ apps: Array.from(next) });
      } catch (e) {
        log.warn('[NotificationSettings] save error:', e);
      }
    }
  };

  const selectAll = async () => {
    const all = new Set(installedBankApps.map(a => a.packageName));
    setSelectedApps(all);
    if (plugin) {
      try { await plugin.saveMonitoredApps({ apps: Array.from(all) }); } catch (e) { log.warn('[NotificationSettings] save error:', e); }
    }
  };

  const selectNone = async () => {
    setSelectedApps(new Set());
    if (plugin) {
      try { await plugin.saveMonitoredApps({ apps: [] }); } catch (e) { log.warn('[NotificationSettings] save error:', e); }
    }
  };

  if (!isNative) {
    return (
      <SettingsCard>
        <span className="font-semibold text-xs text-slate-400 tracking-wide">
          Bank Notification Listener
        </span>
        <p className="text-[11px] text-slate-400 mt-1">
          Available on Android. Install the APK to use this feature.
        </p>
      </SettingsCard>
    );
  }

  return (
    <SettingsCard className="space-y-4">
      {/* Toggle always visible */}
      <div className="flex items-center justify-between">
        <div className="flex-1 mr-3">
          <span className="font-semibold text-xs text-slate-600 dark:text-slate-200 tracking-wide block">
            Bank Notification Listener
          </span>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 leading-tight">
            Auto-log transactions from your banking apps
          </p>
        </div>
        <ToggleSwitch enabled={enabled} onToggle={handleToggle} />
      </div>

      {/* The guided route through Android's permissions — including the
          restricted-settings unlock a sideloaded install needs, which Android
          only offers after it has refused the switch once. */}
      {guideOpen && (
        <NotificationAccessGuide plugin={plugin} onGranted={handleGuideGranted} />
      )}

      {/* Banking app picker */}
      {enabled && permissionGranted && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 tracking-wide">
              Your Banking Apps ({installedBankApps.length} found)
            </span>
            <div className="flex space-x-2">
              <button onClick={selectAll} className="text-[9px] font-semibold text-emerald-600 dark:text-emerald-400">All</button>
              <button onClick={selectNone} className="text-[9px] font-semibold text-slate-400">None</button>
            </div>
          </div>

          {installedBankApps.length === 0 ? (
            loading ? (
              <p className="text-[10px] text-slate-400 text-center py-3">
                Detecting installed banking apps…
              </p>
            ) : (
              <p className="text-[10px] text-slate-400 text-center py-3">
                No supported banking apps detected. If you have banking apps installed, they may not be in our supported list yet.
              </p>
            )
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {installedBankApps.map(app => {
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
                    <span className={`w-4 h-4 rounded-md flex items-center justify-center flex-shrink-0 ${
                      selected
                        ? 'bg-emerald-500'
                        : 'bg-slate-300 dark:bg-slate-600'
                    }`}>
                      {selected && (
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      )}
                    </span>
                    <span className={`text-[10px] font-bold truncate ${
                      selected
                        ? 'text-emerald-700 dark:text-emerald-300'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}>
                      {app.name}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* The "Not recognised" section that used to sit here is gone.
              It offered any installed app whose NAME looked financial, for the
              user to approve. Covault could not vouch for those apps, a Play
              install can never see them in the first place (Google does not
              allow asking what else is on the phone — see
              scripts/play-manifest.mjs), and having it here made the sideloaded
              build behave differently from the one people download, on the one
              screen that decides whether anything is captured at all. A bank
              Covault has never heard of is now added by putting its package in
              lib/bankingApps.ts, which was already the only route on Play. */}

          <p className="text-[9px] text-slate-400 dark:text-slate-500 text-center leading-tight">
            Covault reads notifications from selected apps to auto-log your transactions.
          </p>
        </div>
      )}
    </SettingsCard>
  );
};

export default NotificationSettings;
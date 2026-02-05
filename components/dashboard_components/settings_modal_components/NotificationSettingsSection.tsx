// components/dashboard_components/settings_modal_components/NotificationSettingsSection.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';

interface CovaultNotificationPlugin {
  requestAccess(): Promise<void>;
  isEnabled(): Promise<{ enabled: boolean }>;
  getInstalledApps(): Promise<{ apps: Array<{ packageName: string; name: string }> }>;
  saveMonitoredApps(options: { apps: any }): Promise<void>;
  getMonitoredApps(): Promise<{ apps: string[] }>;
}

// Known banking app package names (must match NotificationListener.java)
const KNOWN_BANKING_APPS: Record<string, string> = {
  // Canadian Banks
  'com.bmo.mobile': 'BMO',
  'com.rbc.mobile.android': 'RBC',
  'com.td': 'TD Canada',
  'com.cibc.android.mobi': 'CIBC',
  'com.scotiabank.mobile': 'Scotiabank',
  'com.bns.mobile': 'Scotiabank',
  'ca.bnc.android': 'National Bank',
  'com.desjardins.mobile': 'Desjardins',
  'com.atb.atbmobile': 'ATB Financial',
  'ca.tangerine.clients.banking': 'Tangerine',
  'com.simplicite.app': 'Simplii',
  'ca.hsbc.hsbccanada': 'HSBC Canada',
  'com.laurentianbank.mobile': 'Laurentian Bank',
  'com.eq.mobile': 'EQ Bank',
  'com.manulife.mobile': 'Manulife',
  // Canadian Fintech
  'com.wealthsimple': 'Wealthsimple',
  'com.wealthsimple.trade': 'Wealthsimple Trade',
  'com.neofinancial.android': 'Neo Financial',
  'com.koho.android': 'KOHO',
  'com.mogo.mobile': 'Mogo',
  'ca.payments.interac': 'Interac',
  'com.questrade.questmobile': 'Questrade',
  // US Banks
  'com.chase.sig.android': 'Chase',
  'com.wf.wellsfargomobile': 'Wells Fargo',
  'com.infonow.bofa': 'Bank of America',
  'com.citi.citimobile': 'Citi',
  'com.usbank.mobilebanking': 'US Bank',
  'com.pnc.ecommerce.mobile': 'PNC',
  'com.tdbank': 'TD Bank',
  'com.capitalone.mobile': 'Capital One',
  'com.key.android': 'KeyBank',
  'com.regions.mobbanking': 'Regions',
  'com.huntington.m': 'Huntington',
  'com.ally.MobileBanking': 'Ally',
  // Credit Cards
  'com.americanexpress.android.acctsvcs.us': 'Amex',
  'com.capitalone.creditcard.app': 'Capital One CC',
  'com.discoverfinancial.mobile': 'Discover',
  'com.synchrony.banking': 'Synchrony',
  // Fintech
  'com.chime.chmapplication': 'Chime',
  'com.sofi.mobile': 'SoFi',
  'com.venmo': 'Venmo',
  'com.squareup.cash': 'Cash App',
  'com.paypal.android.p2pmobile': 'PayPal',
  'com.zellepay.zelle': 'Zelle',
  'com.revolut.revolut': 'Revolut',
  'com.monzo.android': 'Monzo',
  'com.n26.android': 'N26',
  'com.varo': 'Varo',
  // Credit Unions
  'com.navyfederal.android': 'Navy Federal',
  'com.penfed.mobile.banking': 'PenFed',
  'org.becu.mobile': 'BECU',
  // Investment
  'com.robinhood.android': 'Robinhood',
  'com.fidelity.android': 'Fidelity',
  'com.schwab.mobile': 'Schwab',
};

interface NotificationSettingsSectionProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

const NotificationSettingsSection: React.FC<NotificationSettingsSectionProps> = ({ enabled, onToggle }) => {
  const isNative = Capacitor.isNativePlatform();
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [installedBankApps, setInstalledBankApps] = useState<
    Array<{ packageName: string; name: string }>
  >([]);
  const [selectedApps, setSelectedApps] = useState<Set<string>>(new Set());
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

  // Check permission status and load data
  const checkStatus = useCallback(async () => {
    if (!plugin) return;
    try {
      const { enabled: granted } = await plugin.isEnabled();
      setPermissionGranted(granted);
      
      // Sync the toggle with actual permission status
      // If user enabled but permission not granted, turn off the toggle
      if (enabled && !granted) {
        onToggle(false);
      }

      if (granted) {
        const { apps: installed } = await plugin.getInstalledApps();
        const bankApps = installed.filter((a) => a.packageName in KNOWN_BANKING_APPS);

        const named = bankApps
          .map((a) => ({
            packageName: a.packageName,
            name: KNOWN_BANKING_APPS[a.packageName] || a.name,
          }))
          .sort((a, b) => a.name.localeCompare(b.name));

        setInstalledBankApps(named);

        const { apps: saved } = await plugin.getMonitoredApps();
        if (saved && saved.length > 0) {
          setSelectedApps(new Set(saved));
        } else {
          setSelectedApps(new Set(named.map((a) => a.packageName)));
        }
      } else {
        setInstalledBankApps([]);
        setSelectedApps(new Set());
      }
    } catch (e) {
      console.warn('[NotificationSettingsSection] checkStatus error:', e);
    }
  }, [plugin, enabled, onToggle]);

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
  const pollForPermission = useCallback(async () => {
    if (!plugin) return;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const { enabled: granted } = await plugin.isEnabled();
        if (granted) {
          setPermissionGranted(true);
          checkStatus();
          return;
        }
      } catch {
        // ignore
      }
    }
    // If polling ends without permission granted, turn off the toggle
    onToggle(false);
  }, [plugin, checkStatus, onToggle]);

  const handleToggle = async () => {
    if (!isNative || !plugin) return;

    if (enabled) {
      // Logical off (we still can't revoke OS permission from here)
      onToggle(false);
      return;
    }

    // Turning on — open Android notification listener settings
    onToggle(true);
    try {
      await plugin.requestAccess();
      pollForPermission();
    } catch (e) {
      console.error('[NotificationSettingsSection] handleToggle error:', e);
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
        console.warn('[NotificationSettingsSection] save error:', e);
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

  // Browser-only info block - matching other toggle sections
  if (!isNative) {
    return (
      <div className="flex items-center justify-between p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60">
        <div className="flex flex-col">
          <span className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            Bank Notification Listener
          </span>
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium mt-0.5 leading-relaxed">
            Android only • Auto-log transactions.
          </span>
        </div>
        <button
          disabled
          className="w-14 h-8 rounded-full transition-colors relative flex items-center p-1 cursor-not-allowed bg-slate-200 dark:bg-slate-700 opacity-50"
        >
          <div className="w-6 h-6 bg-white rounded-full shadow-lg transform transition-transform duration-300 translate-x-0" />
        </button>
      </div>
    );
  }

  const autoAddActive =
    enabled && permissionGranted && selectedApps.size > 0 && installedBankApps.length > 0;

  return (
    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60">
      {/* Toggle row - matching other toggle sections */}
      <div className="flex items-center justify-between p-6">
        <div className="flex flex-col">
          <span className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            Bank Notification Listener
          </span>
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium mt-0.5 leading-relaxed">
            Auto-log transactions from banking apps.
          </span>
        </div>
        <button
          onClick={handleToggle}
          className={`w-14 h-8 rounded-full transition-colors relative flex items-center p-1 cursor-pointer ${
            enabled ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'
          }`}
        >
          <div
            className={`w-6 h-6 bg-white rounded-full shadow-lg transform transition-transform duration-300 ${
              enabled ? 'translate-x-6' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* Status and app picker - only when enabled */}
      {enabled && (
        <div className="px-6 pb-5 pt-0 space-y-3 border-t border-slate-100 dark:border-slate-800/60">
          {/* STATUS PILL */}
          <div className="pt-3">
            {autoAddActive && (
              <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700">
                <span className="w-2 h-2 rounded-full bg-emerald-500 mr-2" />
                <span className="text-[9px] font-semibold text-emerald-700 dark:text-emerald-300">
                  Auto-adding from {selectedApps.size} app
                  {selectedApps.size === 1 ? '' : 's'}
                </span>
              </span>
            )}

            {!permissionGranted && (
              <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700">
                <span className="w-2 h-2 rounded-full bg-amber-500 mr-2" />
                <span className="text-[9px] font-semibold text-amber-700 dark:text-amber-300">
                  Permission not granted in system settings
                </span>
              </span>
            )}

            {permissionGranted && selectedApps.size === 0 && (
              <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700">
                <span className="w-2 h-2 rounded-full bg-slate-400 mr-2" />
                <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300">
                  No banking apps selected
                </span>
              </span>
            )}
          </div>

          {/* Banking app picker */}
          {permissionGranted && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Your Banking Apps ({installedBankApps.length} found)
                </span>
                <div className="flex space-x-2">
                  <button
                    onClick={selectAll}
                    className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 uppercase"
                  >
                    All
                  </button>
                  <button
                    onClick={selectNone}
                    className="text-[9px] font-bold text-slate-400 uppercase"
                  >
                    None
                  </button>
                </div>
              </div>

              {installedBankApps.length === 0 ? (
                <p className="text-[10px] text-slate-400 text-center py-3">
                  No supported banking apps detected on this device.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {installedBankApps.map((app) => {
                    const selected = selectedApps.has(app.packageName);
                    return (
                      <button
                        key={app.packageName}
                        onClick={() => toggleApp(app.packageName)}
                        className={`flex items-center space-x-2 px-3 py-2.5 rounded-xl text-left transition-all active:scale-95 border ${
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
                          className={`text-[10px] font-bold truncate ${
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

              <p className="text-[9px] text-slate-400 dark:text-slate-500 text-center leading-tight">
                Covault reads notifications from selected apps to auto-log your transactions.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationSettingsSection;

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
      // Sync enabled state with actual permission
      if (granted && !enabled) {
        onToggle(true);
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
          onToggle(true);
          checkStatus();
          return;
        }
      } catch {
        // ignore
      }
    }
  }, [plugin, checkStatus]);

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

  // Browser-only info block - now with toggle
  if (!isNative) {
    return (
      <div id="settings-notifications-container" className="p-5 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex-1 mr-3">
            <span className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 block">
              Bank Notification Listener
            </span>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 leading-relaxed">
              Auto-log transactions from supported banking apps.
            </p>
            
            {/* Info message for browser */}
            <div className="mt-2">
              <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700">
                <span className="w-2 h-2 rounded-full bg-slate-400 mr-2" />
                <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300">
                  Available on Android app only
                </span>
              </span>
            </div>
          </div>

          {/* Disabled toggle for browser */}
          <button
            disabled
            className="relative w-12 h-7 rounded-full transition-colors duration-200 flex-shrink-0 bg-slate-300 dark:bg-slate-600 opacity-50 cursor-not-allowed"
          >
            <span className="absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform duration-200 translate-x-0" />
          </button>
        </div>
        
        <p className="text-[9px] text-slate-400 dark:text-slate-500 leading-tight">
          Install the Covault Android app and enable notification access to auto-log your banking transactions.
        </p>
      </div>
    );
  }

  const autoAddActive =
    enabled && permissionGranted && selectedApps.size > 0 && installedBankApps.length > 0;

  return (
    <div id="settings-notifications-container" className="p-5 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60 space-y-4">
      {/* TOGGLE + STATUS */}
      <div className="flex items-center justify-between">
        <div className="flex-1 mr-3">
          <span className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 block">
            Bank Notification Listener
          </span>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 leading-relaxed">
            Auto-log transactions from supported banking apps.
          </p>

          {/* STATUS PILL */}
          <div className="mt-2">
            {autoAddActive && (
              <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700">
                <span className="w-2 h-2 rounded-full bg-emerald-500 mr-2" />
                <span className="text-[9px] font-semibold text-emerald-700 dark:text-emerald-300">
                  Auto-adding from {selectedApps.size} app
                  {selectedApps.size === 1 ? '' : 's'}
                </span>
              </span>
            )}

            {!permissionGranted && enabled && (
              <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700">
                <span className="w-2 h-2 rounded-full bg-amber-500 mr-2" />
                <span className="text-[9px] font-semibold text-amber-700 dark:text-amber-300">
                  Permission not granted in system settings
                </span>
              </span>
            )}

            {enabled && permissionGranted && selectedApps.size === 0 && (
              <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700">
                <span className="w-2 h-2 rounded-full bg-slate-400 mr-2" />
                <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300">
                  No banking apps selected
                </span>
              </span>
            )}
          </div>
        </div>

        <button
          onClick={handleToggle}
          className={`relative w-12 h-7 rounded-full transition-colors duration-200 flex-shrink-0 ${
            enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform duration-200 ${
              enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* Banking app picker */}
      {enabled && permissionGranted && (
        <div className="space-y-3">
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
              No banking app notifications received yet. Once a notification arrives from a supported app, it will appear here automatically.
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
        </div>
      )}
    </div>
  );
};

export default NotificationSettingsSection;

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

interface NotificationSettingsProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

const NotificationSettings: React.FC<NotificationSettingsProps> = ({ enabled, onToggle }) => {
  const isNative = Capacitor.isNativePlatform();
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [installedBankApps, setInstalledBankApps] = useState<Array<{ packageName: string; name: string }>>([]);
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

  // Check permission status and load data when component mounts or becomes visible
  const checkStatus = useCallback(async () => {
    if (!plugin) return;
    try {
      const { enabled: granted } = await plugin.isEnabled();
      setPermissionGranted(granted);

      if (granted) {
        // Load installed apps and filter to known banking apps
        const { apps: installed } = await plugin.getInstalledApps();
        const bankApps = installed.filter(a => a.packageName in KNOWN_BANKING_APPS);
        // Use our friendly names
        const named = bankApps.map(a => ({
          packageName: a.packageName,
          name: KNOWN_BANKING_APPS[a.packageName] || a.name,
        }));
        named.sort((a, b) => a.name.localeCompare(b.name));
        setInstalledBankApps(named);

        // Load previously saved selections
        const { apps: saved } = await plugin.getMonitoredApps();
        if (saved && saved.length > 0) {
          setSelectedApps(new Set(saved));
        } else {
          // Default: select all banking apps found
          setSelectedApps(new Set(named.map(a => a.packageName)));
        }
      }
    } catch (e) {
      console.warn('[NotificationSettings] checkStatus error:', e);
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

  // Also poll briefly after requesting access (covers cases where resume doesn't fire)
  const pollForPermission = useCallback(async () => {
    if (!plugin) return;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const { enabled: granted } = await plugin.isEnabled();
        if (granted) {
          setPermissionGranted(true);
          checkStatus();
          return;
        }
      } catch { /* ignore */ }
    }
  }, [plugin, checkStatus]);

  const handleToggle = async () => {
    if (!isNative || !plugin) return;

    if (enabled) {
      onToggle(false);
      return;
    }

    // Turning on — immediately open the real Android notification listener settings
    onToggle(true);
    try {
      await plugin.requestAccess();
      // Poll for permission after user returns from settings
      pollForPermission();
    } catch (e) {
      console.error('[NotificationSettings] handleToggle error:', e);
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

    // Persist
    if (plugin) {
      try {
        await plugin.saveMonitoredApps({ apps: Array.from(next) });
      } catch (e) {
        console.warn('[NotificationSettings] save error:', e);
      }
    }
  };

  const selectAll = async () => {
    const all = new Set(installedBankApps.map(a => a.packageName));
    setSelectedApps(all);
    if (plugin) {
      try { await plugin.saveMonitoredApps({ apps: Array.from(all) }); } catch {}
    }
  };

  const selectNone = async () => {
    setSelectedApps(new Set());
    if (plugin) {
      try { await plugin.saveMonitoredApps({ apps: [] }); } catch {}
    }
  };

  if (!isNative) {
    return (
      <div className="p-5 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60">
        <span className="font-black text-xs text-slate-400 uppercase tracking-tight">
          Bank Notification Listener
        </span>
        <p className="text-[11px] text-slate-400 mt-1">
          Available on Android. Install the APK to use this feature.
        </p>
      </div>
    );
  }

  return (
    <div className="p-5 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60 space-y-4">
      {/* Toggle row */}
      <div className="flex items-center justify-between">
        <div className="flex-1 mr-3">
          <span className="font-black text-xs text-slate-600 dark:text-slate-200 uppercase tracking-tight block">
            Bank Notification Listener
          </span>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 leading-tight">
            Auto-log transactions from your banking apps
          </p>
        </div>
        <button
          onClick={handleToggle}
          className={`relative w-12 h-7 rounded-full transition-colors duration-200 flex-shrink-0 ${
            enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
          }`}
        >
          <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform duration-200 ${
            enabled ? 'translate-x-5' : 'translate-x-0'
          }`} />
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
              <button onClick={selectAll} className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 uppercase">All</button>
              <button onClick={selectNone} className="text-[9px] font-bold text-slate-400 uppercase">None</button>
            </div>
          </div>

          {installedBankApps.length === 0 ? (
            <p className="text-[10px] text-slate-400 text-center py-3">
              No supported banking apps detected on this device.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {installedBankApps.map(app => {
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

          <p className="text-[9px] text-slate-400 dark:text-slate-500 text-center leading-tight">
            Covault reads notifications from selected apps to auto-log your transactions.
          </p>
        </div>
      )}
    </div>
  );
};

export default NotificationSettings;

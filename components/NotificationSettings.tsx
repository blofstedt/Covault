
import React, { useState } from 'react';
import { Capacitor } from '@capacitor/core';

interface NotificationSettingsProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

// Known banking apps with display names
const BANKING_APPS = [
  { id: 'com.chase.sig.android', name: 'Chase' },
  { id: 'com.wf.wellsfargomobile', name: 'Wells Fargo' },
  { id: 'com.infonow.bofa', name: 'Bank of America' },
  { id: 'com.citi.citimobile', name: 'Citi' },
  { id: 'com.usbank.mobilbanking', name: 'US Bank' },
  { id: 'com.pnc.ecommerce.mobile', name: 'PNC' },
  { id: 'com.tdbank', name: 'TD Bank' },
  { id: 'com.capitalone.creditcard', name: 'Capital One' },
  { id: 'com.huntington.m', name: 'Huntington' },
  { id: 'com.ally.MobileBanking', name: 'Ally' },
  { id: 'com.squareup.cash', name: 'Cash App' },
  { id: 'com.venmo', name: 'Venmo' },
  { id: 'com.paypal.android.p2pmobile', name: 'PayPal' },
  { id: 'com.sofi.mobile', name: 'SoFi' },
  { id: 'com.chime.cta', name: 'Chime' },
  { id: 'com.zellepay.zelle', name: 'Zelle' },
  { id: 'com.americanexpress.android.acctsvcs.us', name: 'Amex' },
  { id: 'com.discoverfinancial.mobile', name: 'Discover' },
  { id: 'com.navyfederal.android', name: 'Navy Federal' },
  { id: 'com.robinhood.android', name: 'Robinhood' },
];

const NotificationSettings: React.FC<NotificationSettingsProps> = ({ enabled, onToggle }) => {
  const [selectedApps, setSelectedApps] = useState<Set<string>>(new Set());
  const [showAppPicker, setShowAppPicker] = useState(false);
  const isNative = Capacitor.isNativePlatform();

  const handleToggle = () => {
    if (!enabled && isNative) {
      // Prompt to enable notification access in system settings
      try {
        // On Android, direct to notification listener settings
        (window as any).AndroidNotificationPermission?.requestAccess?.();
      } catch {
        // Fallback: show instruction
      }
    }
    onToggle(!enabled);
    if (!enabled) {
      setShowAppPicker(true);
    }
  };

  const toggleApp = (appId: string) => {
    const next = new Set(selectedApps);
    if (next.has(appId)) next.delete(appId);
    else next.add(appId);
    setSelectedApps(next);
  };

  return (
    <div className="p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col flex-1 mr-4">
          <span className="font-black text-base text-slate-500 dark:text-slate-200 uppercase tracking-tight">
            Auto-File Transactions
          </span>
          <p className="text-[11px] text-slate-500 font-medium mt-1">
            Listen for banking notifications and auto-log transactions. Covault extracts the vendor and amount automatically.
          </p>
        </div>
        <button
          onClick={handleToggle}
          className={`w-14 h-8 rounded-full transition-colors relative flex items-center p-1 cursor-pointer shrink-0 ${enabled ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}`}
        >
          <div className={`w-6 h-6 bg-white rounded-full shadow-lg transform transition-transform duration-300 ${enabled ? 'translate-x-6' : 'translate-x-0'}`} />
        </button>
      </div>

      {enabled && !isNative && (
        <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-2xl border border-amber-200 dark:border-amber-800/40">
          <p className="text-[11px] font-bold text-amber-600 dark:text-amber-400">
            Notification listening requires the native Android app. Install Covault from your app build to use this feature.
          </p>
        </div>
      )}

      {enabled && isNative && (
        <div className="space-y-3">
          <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl border border-emerald-200 dark:border-emerald-800/40">
            <p className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
              You need to grant Notification Access in your device settings. Tap below to open settings.
            </p>
            <button
              onClick={() => {
                try {
                  (window as any).AndroidNotificationPermission?.requestAccess?.();
                } catch { /* no-op */ }
              }}
              className="mt-3 w-full py-3 bg-emerald-600 text-white text-[10px] font-black rounded-xl uppercase tracking-widest active:scale-95 transition-all"
            >
              Open Notification Settings
            </button>
          </div>

          <button
            onClick={() => setShowAppPicker(!showAppPicker)}
            className="w-full py-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl text-[11px] font-black text-slate-500 dark:text-slate-300 uppercase tracking-widest active:scale-95 transition-all"
          >
            {showAppPicker ? 'Hide' : 'Select'} Banking Apps ({selectedApps.size} selected)
          </button>

          {showAppPicker && (
            <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto no-scrollbar">
              {BANKING_APPS.map(app => (
                <button
                  key={app.id}
                  onClick={() => toggleApp(app.id)}
                  className={`p-3 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border ${
                    selectedApps.has(app.id)
                      ? 'bg-emerald-500 text-white border-emerald-500 shadow-md'
                      : 'bg-white dark:bg-slate-900 text-slate-400 border-slate-100 dark:border-slate-800'
                  }`}
                >
                  {app.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationSettings;


import React, { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';

interface NotificationSettingsProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

const NotificationSettings: React.FC<NotificationSettingsProps> = ({ enabled, onToggle }) => {
  const [permissionGranted, setPermissionGranted] = useState(false);
  const isNative = Capacitor.isNativePlatform();

  const checkPermission = async () => {
    if (!isNative) return;
    try {
      const result = await (window as any).AndroidNotificationPermission?.isEnabled?.();
      setPermissionGranted(!!result);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    checkPermission();
    // Re-check when the app comes back to foreground (user may return from settings)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkPermission();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  const requestPermission = () => {
    try {
      // Opens Android's ACTION_NOTIFICATION_LISTENER_SETTINGS intent
      (window as any).AndroidNotificationPermission?.requestAccess?.();
      // Re-check after user returns from settings
      setTimeout(checkPermission, 2000);
      setTimeout(checkPermission, 5000);
    } catch { /* ignore */ }
  };

  const handleToggle = () => {
    if (!enabled && isNative) {
      requestPermission();
    }
    onToggle(!enabled);
  };

  return (
    <div className="p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col flex-1 mr-4">
          <span className="font-black text-base text-slate-500 dark:text-slate-200 uppercase tracking-tight">
            Auto-File Transactions
          </span>
          <p className="text-[11px] text-slate-500 font-medium mt-1">
            Listen for banking notifications and auto-log transactions. Covault detects your banking apps automatically.
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
          <div className={`p-4 rounded-2xl border ${permissionGranted ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/40' : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/40'}`}>
            <div className="flex items-center space-x-3">
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${permissionGranted ? 'bg-emerald-500' : 'bg-amber-500'}`}>
                {permissionGranted ? (
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
                ) : (
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v2m0 4h.01" /></svg>
                )}
              </div>
              <p className={`text-[11px] font-bold flex-1 ${permissionGranted ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                {permissionGranted
                  ? 'Notification access granted. Covault is listening for banking transactions.'
                  : 'Grant notification access so Covault can read your banking alerts.'}
              </p>
            </div>
          </div>

          <button
            onClick={requestPermission}
            className={`w-full py-3 text-white text-[10px] font-black rounded-xl uppercase tracking-widest active:scale-95 transition-all ${permissionGranted ? 'bg-slate-400 dark:bg-slate-600' : 'bg-emerald-600'}`}
          >
            {permissionGranted ? 'Re-check Permission' : 'Open Notification Settings'}
          </button>

          <div className="p-3 bg-slate-100/50 dark:bg-slate-800/30 rounded-2xl">
            <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium text-center">
              Covault automatically detects notifications from banking and payment apps installed on your device.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationSettings;

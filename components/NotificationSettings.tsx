
import React, { useState } from 'react';
import { Capacitor } from '@capacitor/core';

interface NotificationSettingsProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

const NotificationSettings: React.FC<NotificationSettingsProps> = ({ enabled, onToggle }) => {
  const [showInstructions, setShowInstructions] = useState(false);
  const isNative = Capacitor.isNativePlatform();

  const openNotificationSettings = async () => {
    // Try the native plugin first (if APK includes CovaultNotificationPlugin)
    try {
      const plugin = (Capacitor as any).Plugins?.CovaultNotification;
      if (plugin && typeof plugin.requestAccess === 'function') {
        await plugin.requestAccess();
        return;
      }
    } catch { /* plugin not available, fall through */ }

    // Fallback: show step-by-step guide to enable manually
    setShowInstructions(true);
  };

  const handleToggle = () => {
    if (!enabled) {
      openNotificationSettings();
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
            Covault reads your banking notifications and automatically logs transactions.
          </p>
        </div>
        <button
          onClick={handleToggle}
          className={`w-14 h-8 rounded-full transition-colors relative flex items-center p-1 cursor-pointer shrink-0 ${enabled ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}`}
        >
          <div className={`w-6 h-6 bg-white rounded-full shadow-lg transform transition-transform duration-300 ${enabled ? 'translate-x-6' : 'translate-x-0'}`} />
        </button>
      </div>

      {enabled && (
        <div className="space-y-3">
          {/* Step 1: Grant notification access */}
          <div className="p-4 rounded-2xl border bg-slate-100 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700/40">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-slate-700 dark:bg-slate-200">
                <span className="text-white dark:text-slate-900 text-[11px] font-black">1</span>
              </div>
              <div className="flex-1">
                <p className="text-[12px] font-black text-slate-600 dark:text-slate-200">Grant Notification Access</p>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">Allow Covault to read notifications from your banking apps.</p>
              </div>
            </div>
            <button
              onClick={openNotificationSettings}
              className="w-full mt-3 py-3 bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-900 text-[10px] font-black rounded-xl uppercase tracking-widest active:scale-95 transition-all"
            >
              Open Notification Settings
            </button>
          </div>

          {/* Instructions overlay */}
          {showInstructions && (
            <div className="p-5 rounded-2xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700/40 space-y-4">
              <p className="text-[12px] font-black text-slate-600 dark:text-slate-200 text-center">
                Enable Notification Access
              </p>
              <div className="space-y-3">
                <div className="flex items-start space-x-3">
                  <div className="w-6 h-6 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-[10px] font-black text-slate-500 dark:text-slate-400">1</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                    Open your phone's <span className="font-black text-slate-700 dark:text-slate-200">Settings</span> app
                  </p>
                </div>
                <div className="flex items-start space-x-3">
                  <div className="w-6 h-6 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-[10px] font-black text-slate-500 dark:text-slate-400">2</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                    Go to <span className="font-black text-slate-700 dark:text-slate-200">Apps → Special Access → Notification Access</span>
                  </p>
                </div>
                <div className="flex items-start space-x-3">
                  <div className="w-6 h-6 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-[10px] font-black text-slate-500 dark:text-slate-400">3</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                    Find <span className="font-black text-slate-700 dark:text-slate-200">Covault</span> and toggle it <span className="font-black text-slate-700 dark:text-slate-200">ON</span>
                  </p>
                </div>
              </div>
              <p className="text-[10px] text-slate-400 dark:text-slate-600 text-center pt-1">
                Covault automatically detects transactions from all major banking apps.
              </p>
              <button
                onClick={() => setShowInstructions(false)}
                className="w-full py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest"
              >
                Got it
              </button>
            </div>
          )}

          {/* Info about what it monitors */}
          {!showInstructions && (
            <div className="p-3 bg-slate-100/50 dark:bg-slate-800/30 rounded-2xl">
              <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium text-center">
                Covault automatically detects transactions from Chase, Bank of America, Wells Fargo, Capital One, Venmo, Cash App, Zelle, and 30+ more banking apps.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationSettings;


import React from 'react';
import { Capacitor } from '@capacitor/core';

interface NotificationSettingsProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

const NotificationSettings: React.FC<NotificationSettingsProps> = ({ enabled, onToggle }) => {
  const isNative = Capacitor.isNativePlatform();

  const openNotificationListenerSettings = () => {
    // Capacitor's BridgeWebViewClient intercepts intent:// URIs and starts them
    // as real Android Intents via startActivity(). This opens the system's
    // Notification Listener Settings screen where the user can grant Covault
    // permission to read notifications from banking apps.
    window.location.href = 'intent:#Intent;action=android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS;end';
  };

  return (
    <div className="p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60 space-y-4">
      <div className="flex flex-col space-y-2">
        <span className="font-black text-base text-slate-500 dark:text-slate-200 uppercase tracking-tight">
          Bank Notification Listener
        </span>
        <p className="text-[11px] text-slate-500 font-medium">
          Allow Covault to read your banking app notifications and automatically log transactions.
        </p>
      </div>

      {isNative ? (
        <div className="space-y-3">
          <button
            onClick={openNotificationListenerSettings}
            className="w-full py-4 bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-900 text-[11px] font-black rounded-2xl uppercase tracking-widest active:scale-95 transition-all flex items-center justify-center space-x-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93s.844.141 1.185-.085l.723-.48a1.125 1.125 0 011.543.387l.547.948a1.125 1.125 0 01-.322 1.465l-.574.413a1.125 1.125 0 00-.43 1.067c.024.2.024.404 0 .605a1.125 1.125 0 00.43 1.067l.574.413a1.125 1.125 0 01.322 1.465l-.547.948a1.125 1.125 0 01-1.543.387l-.723-.48a1.125 1.125 0 00-1.185-.085c-.396.166-.71.506-.78.93l-.149.894c-.09.542-.56.94-1.11.94h-1.093c-.55 0-1.02-.398-1.11-.94l-.149-.894a1.125 1.125 0 00-.78-.93 1.125 1.125 0 00-1.185.085l-.723.48a1.125 1.125 0 01-1.543-.387l-.547-.948a1.125 1.125 0 01.322-1.465l.574-.413a1.125 1.125 0 00.43-1.067 4.5 4.5 0 010-.605 1.125 1.125 0 00-.43-1.067l-.574-.413a1.125 1.125 0 01-.322-1.465l.547-.948a1.125 1.125 0 011.543-.387l.723.48c.34.226.78.255 1.185.085s.71-.506.78-.93l.149-.894z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span>Open Notification Settings</span>
          </button>

          <div className="p-3 bg-slate-100/50 dark:bg-slate-800/30 rounded-2xl">
            <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium text-center">
              This opens your phone's settings where you grant Covault access to read notifications from RBC, BMO, TD, CIBC, Scotiabank, Wealthsimple, Neo, KOHO, Chase, Capital One, Venmo, Cash App, and 50+ more banking apps.
            </p>
          </div>
        </div>
      ) : (
        <div className="p-4 rounded-2xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/40">
          <p className="text-[11px] text-slate-400 font-medium text-center">
            Notification listening is available on the Android app. Install the APK to use this feature.
          </p>
        </div>
      )}
    </div>
  );
};

export default NotificationSettings;

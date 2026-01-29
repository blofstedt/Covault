
import React, { useState, useEffect, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';

interface NotificationSettingsProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

interface InstalledApp {
  packageName: string;
  name: string;
}

// Access the native plugin through Capacitor's bridge directly
const getPlugin = (): any => {
  try {
    return (Capacitor as any).Plugins?.CovaultNotification;
  } catch {
    return null;
  }
};

const NotificationSettings: React.FC<NotificationSettingsProps> = ({ enabled, onToggle }) => {
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [pluginAvailable, setPluginAvailable] = useState(false);
  const [showAppPicker, setShowAppPicker] = useState(false);
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([]);
  const [monitoredApps, setMonitoredApps] = useState<Set<string>>(new Set());
  const [loadingApps, setLoadingApps] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const isNative = Capacitor.isNativePlatform();

  const checkPluginAvailable = useCallback(async () => {
    if (!isNative) return;
    const plugin = getPlugin();
    if (plugin && typeof plugin.isEnabled === 'function') {
      setPluginAvailable(true);
      return true;
    }
    setPluginAvailable(false);
    return false;
  }, [isNative]);

  const checkPermission = useCallback(async () => {
    if (!isNative) return;
    try {
      const plugin = getPlugin();
      if (!plugin) return;
      const result = await plugin.isEnabled();
      setPermissionGranted(!!result?.enabled);
      setPluginAvailable(true);
      setError(null);
    } catch {
      setPluginAvailable(false);
    }
  }, [isNative]);

  const loadMonitoredApps = useCallback(async () => {
    if (!isNative) return;
    try {
      const plugin = getPlugin();
      if (!plugin) return;
      const result = await plugin.getMonitoredApps();
      if (result?.apps && Array.isArray(result.apps)) {
        setMonitoredApps(new Set(result.apps));
      }
    } catch { /* ignore */ }
  }, [isNative]);

  useEffect(() => {
    checkPluginAvailable();
    checkPermission();
    loadMonitoredApps();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkPermission();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [checkPluginAvailable, checkPermission, loadMonitoredApps]);

  const requestPermission = async () => {
    setError(null);
    if (!isNative) {
      setError('Notification listening requires the native Android app.');
      return;
    }
    try {
      const plugin = getPlugin();
      if (!plugin) {
        setError('Native plugin not found. Rebuild the APK after running: npm run cap:sync');
        return;
      }
      await plugin.requestAccess();
      // Re-check after user returns from settings
      setTimeout(checkPermission, 1500);
      setTimeout(checkPermission, 4000);
      setTimeout(checkPermission, 8000);
    } catch (e: any) {
      setError('Could not open notification settings. Rebuild APK with: npm run cap:sync');
    }
  };

  const handleToggle = async () => {
    if (!enabled && isNative) {
      await requestPermission();
    }
    onToggle(!enabled);
  };

  const openAppPicker = async () => {
    setError(null);
    setLoadingApps(true);
    try {
      const plugin = getPlugin();
      if (!plugin) {
        setError('Native plugin not found. Rebuild the APK after running: npm run cap:sync');
        setLoadingApps(false);
        return;
      }
      const result = await plugin.getInstalledApps();
      const apps = (result?.apps || []).sort((a: InstalledApp, b: InstalledApp) => a.name.localeCompare(b.name));
      setInstalledApps(apps);
      setShowAppPicker(true);
    } catch {
      setError('Could not load installed apps. Rebuild the APK after running: npm run cap:sync');
    }
    setLoadingApps(false);
  };

  const toggleApp = (packageName: string) => {
    setMonitoredApps(prev => {
      const next = new Set(prev);
      if (next.has(packageName)) next.delete(packageName);
      else next.add(packageName);
      return next;
    });
  };

  const saveAppSelection = async () => {
    try {
      const plugin = getPlugin();
      if (plugin) {
        await plugin.saveMonitoredApps({ apps: Array.from(monitoredApps) });
      }
    } catch { /* ignore */ }
    setShowAppPicker(false);
  };

  const filteredApps = searchFilter
    ? installedApps.filter(a => a.name.toLowerCase().includes(searchFilter.toLowerCase()))
    : installedApps;

  return (
    <div className="p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col flex-1 mr-4">
          <span className="font-black text-base text-slate-500 dark:text-slate-200 uppercase tracking-tight">
            Auto-File Transactions
          </span>
          <p className="text-[11px] text-slate-500 font-medium mt-1">
            Listen for banking notifications and auto-log transactions.
          </p>
        </div>
        <button
          onClick={handleToggle}
          className={`w-14 h-8 rounded-full transition-colors relative flex items-center p-1 cursor-pointer shrink-0 ${enabled ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}`}
        >
          <div className={`w-6 h-6 bg-white rounded-full shadow-lg transform transition-transform duration-300 ${enabled ? 'translate-x-6' : 'translate-x-0'}`} />
        </button>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 dark:bg-rose-900/20 rounded-2xl border border-rose-200 dark:border-rose-800/40">
          <p className="text-[11px] font-bold text-rose-600 dark:text-rose-400">{error}</p>
        </div>
      )}

      {enabled && !isNative && (
        <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-2xl border border-amber-200 dark:border-amber-800/40">
          <p className="text-[11px] font-bold text-amber-600 dark:text-amber-400">
            Notification listening requires the native Android app. Install Covault from your app build to use this feature.
          </p>
        </div>
      )}

      {enabled && isNative && (
        <div className="space-y-3">
          {/* Plugin status */}
          {!pluginAvailable && (
            <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-2xl border border-amber-200 dark:border-amber-800/40">
              <p className="text-[11px] font-bold text-amber-600 dark:text-amber-400">
                Native notification plugin not detected. To enable:{'\n'}
                1. Run <span className="font-mono">npm run cap:sync</span>{'\n'}
                2. Rebuild the Android APK{'\n'}
                3. Install the new APK on your device
              </p>
            </div>
          )}

          {/* Permission status */}
          <div className={`p-4 rounded-2xl border ${permissionGranted ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/40' : 'bg-slate-100 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700/40'}`}>
            <div className="flex items-center space-x-3">
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${permissionGranted ? 'bg-emerald-500' : 'bg-slate-400'}`}>
                {permissionGranted ? (
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
                ) : (
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                )}
              </div>
              <p className={`text-[11px] font-bold flex-1 ${permissionGranted ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
                {permissionGranted
                  ? 'Notification access granted. Covault is listening.'
                  : 'Notification access required to detect banking transactions.'}
              </p>
            </div>
          </div>

          {!permissionGranted && (
            <button
              onClick={requestPermission}
              className="w-full py-3.5 bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-900 text-[10px] font-black rounded-xl uppercase tracking-widest active:scale-95 transition-all"
            >
              Grant Notification Access
            </button>
          )}

          {permissionGranted && (
            <>
              <button
                onClick={openAppPicker}
                className="w-full py-3.5 bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-900 text-[10px] font-black rounded-xl uppercase tracking-widest active:scale-95 transition-all"
              >
                {loadingApps ? 'Loading...' : 'Choose Banking Apps to Monitor'}
              </button>

              {monitoredApps.size > 0 && (
                <div className="p-3 bg-slate-100/50 dark:bg-slate-800/30 rounded-2xl">
                  <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 text-center">
                    Monitoring {monitoredApps.size} app{monitoredApps.size !== 1 ? 's' : ''}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Full-screen app picker overlay */}
      {showAppPicker && (
        <div className="fixed inset-0 z-[200] bg-white dark:bg-slate-950 flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800">
            <button onClick={() => setShowAppPicker(false)} className="text-slate-400 p-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            <span className="text-[11px] font-black text-slate-500 dark:text-slate-200 uppercase tracking-widest">
              Select Banking Apps
            </span>
            <button onClick={saveAppSelection} className="text-slate-900 dark:text-slate-100 text-[11px] font-black uppercase tracking-wider p-2">
              Done
            </button>
          </div>

          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800">
            <input
              type="text"
              value={searchFilter}
              onChange={e => setSearchFilter(e.target.value)}
              placeholder="Search apps..."
              className="w-full bg-slate-100 dark:bg-slate-900 rounded-xl px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 placeholder-slate-400 outline-none border-2 border-transparent focus:border-slate-400"
            />
          </div>

          <div className="flex-1 overflow-y-auto no-scrollbar">
            {filteredApps.map(app => (
              <button
                key={app.packageName}
                onClick={() => toggleApp(app.packageName)}
                className="flex items-center w-full px-5 py-3.5 border-b border-slate-50 dark:border-slate-900 active:bg-slate-50 dark:active:bg-slate-900 transition-colors"
              >
                <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center mr-4 shrink-0 transition-colors ${monitoredApps.has(app.packageName) ? 'bg-slate-800 dark:bg-slate-100 border-slate-800 dark:border-slate-100' : 'border-slate-300 dark:border-slate-600'}`}>
                  {monitoredApps.has(app.packageName) && (
                    <svg className="w-3.5 h-3.5 text-white dark:text-slate-900" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
                  )}
                </div>
                <div className="flex flex-col text-left flex-1 min-w-0">
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{app.name}</span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 truncate">{app.packageName}</span>
                </div>
              </button>
            ))}
            {filteredApps.length === 0 && (
              <div className="py-20 text-center text-[11px] font-bold text-slate-300 dark:text-slate-700 uppercase tracking-widest">
                No apps found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationSettings;

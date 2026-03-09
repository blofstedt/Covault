package com.covault.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.util.List;

@CapacitorPlugin(name = "CovaultNotification")
public class CovaultNotificationPlugin extends Plugin {

    private static final String TAG = "CovaultNotificationPlugin";
    private static final String TRANSACTION_ACTION = "com.covault.app.TRANSACTION_DETECTED";

    private BroadcastReceiver transactionReceiver;

    @Override
    public void load() {
        // Register a BroadcastReceiver to pick up transactions from NotificationListener
        transactionReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (TRANSACTION_ACTION.equals(intent.getAction())) {
                    String data = intent.getStringExtra("transaction_data");
                    if (data != null) {
                        try {
                            JSONObject json = new JSONObject(data);
                            JSObject event = new JSObject();
                            if (json.has("amount")) {
                                event.put("amount", json.optDouble("amount", 0));
                            }
                            event.put("vendor", json.optString("vendor", "Unknown Merchant"));
                            event.put("source_app", json.optString("source_app", ""));
                            event.put("raw_text", json.optString("raw_text", ""));
                            event.put("timestamp", json.optLong("timestamp", System.currentTimeMillis()));
                            event.put("from_scan", json.optBoolean("from_scan", false));

                            // Send to JavaScript listeners
                            notifyListeners("transactionDetected", event);
                            Log.i(TAG, "Forwarded transaction to JS: " + (event.has("amount") ? "$" + event.optDouble("amount", 0) : "amount pending") + " at " + event.optString("vendor"));
                        } catch (Exception e) {
                            Log.e(TAG, "Error parsing transaction broadcast", e);
                        }
                    }
                }
            }
        };

        IntentFilter filter = new IntentFilter(TRANSACTION_ACTION);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getContext().registerReceiver(transactionReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            getContext().registerReceiver(transactionReceiver, filter);
        }
        Log.i(TAG, "Transaction broadcast receiver registered");

        // Auto-detect installed banking apps and save to SharedPreferences
        // so the NotificationListener can monitor them immediately,
        // even before the user opens the notification settings UI.
        autoDetectBankingApps();
    }

    /**
     * Scan installed apps, cross-reference with the known banking apps list,
     * and merge any newly installed banking apps into the saved monitored list.
     */
    private void autoDetectBankingApps() {
        try {
            String stored = getContext().getSharedPreferences("covault_prefs", 0)
                .getString("monitored_apps", "[]");
            org.json.JSONArray existing = new org.json.JSONArray(stored);

            // Build a set of already-saved package names
            java.util.Set<String> savedSet = new java.util.HashSet<>();
            for (int i = 0; i < existing.length(); i++) {
                String pkg = existing.optString(i, "").trim();
                if (!pkg.isEmpty()) {
                    savedSet.add(pkg);
                }
            }

            PackageManager pm = getContext().getPackageManager();
            List<ApplicationInfo> apps = pm.getInstalledApplications(PackageManager.GET_META_DATA);

            boolean changed = false;
            for (ApplicationInfo app : apps) {
                if (NotificationListener.BANKING_APPS.contains(app.packageName)) {
                    if (!savedSet.contains(app.packageName)) {
                        savedSet.add(app.packageName);
                        changed = true;
                    }
                }
            }

            if (changed) {
                org.json.JSONArray merged = new org.json.JSONArray();
                for (String pkg : savedSet) {
                    merged.put(pkg);
                }
                getContext().getSharedPreferences("covault_prefs", 0)
                    .edit()
                    .putString("monitored_apps", merged.toString())
                    .apply();
                Log.i(TAG, "autoDetectBankingApps: merged to " + savedSet.size() + " monitored apps");
            } else {
                Log.i(TAG, "autoDetectBankingApps: no new banking apps to add (" + savedSet.size() + " already saved)");
            }
        } catch (Exception e) {
            Log.w(TAG, "autoDetectBankingApps: error during auto-detection", e);
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (transactionReceiver != null) {
            try {
                getContext().unregisterReceiver(transactionReceiver);
            } catch (Exception e) {
                // Already unregistered
            }
        }
    }

    @PluginMethod
    public void requestAccess(PluginCall call) {
        // Always open the notification listener settings page
        // This allows the user to enable "Notification read, reply & control" for Covault
        Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
        getActivity().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void isEnabled(PluginCall call) {
        String packageName = getContext().getPackageName();
        String flat = Settings.Secure.getString(
            getContext().getContentResolver(),
            "enabled_notification_listeners"
        );
        boolean enabled = flat != null && flat.contains(packageName);
        JSObject ret = new JSObject();
        ret.put("enabled", enabled);
        call.resolve(ret);
    }

    @PluginMethod
    public void getInstalledApps(PluginCall call) {
        PackageManager pm = getContext().getPackageManager();
        List<ApplicationInfo> apps = pm.getInstalledApplications(PackageManager.GET_META_DATA);
        JSArray result = new JSArray();
        for (ApplicationInfo app : apps) {
            // Include non-system apps and any known banking app (which may be
            // pre-installed or flagged as a system app on some devices).
            boolean isUserApp = (app.flags & ApplicationInfo.FLAG_SYSTEM) == 0;
            boolean isKnownBank = NotificationListener.BANKING_APPS.contains(app.packageName);
            if (isUserApp || isKnownBank) {
                JSObject obj = new JSObject();
                obj.put("packageName", app.packageName);
                obj.put("name", pm.getApplicationLabel(app).toString());
                result.put(obj);
            }
        }
        JSObject ret = new JSObject();
        ret.put("apps", result);
        call.resolve(ret);
    }

    @PluginMethod
    public void saveMonitoredApps(PluginCall call) {
        JSArray apps = call.getArray("apps");
        if (apps != null) {
            getContext().getSharedPreferences("covault_prefs", 0)
                .edit()
                .putString("monitored_apps", apps.toString())
                .apply();
        }
        call.resolve();
    }

    @PluginMethod
    public void getMonitoredApps(PluginCall call) {
        String stored = getContext().getSharedPreferences("covault_prefs", 0)
            .getString("monitored_apps", "[]");
        JSObject ret = new JSObject();
        try {
            ret.put("apps", new JSArray(stored));
        } catch (Exception e) {
            ret.put("apps", new JSArray());
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void scanActiveNotifications(PluginCall call) {
        // Re-run auto-detection so newly installed banking apps are picked up
        // before scanning active notifications.
        autoDetectBankingApps();

        NotificationListener listener = NotificationListener.getInstance();
        if (listener != null) {
            listener.scanActiveNotifications();
            Log.i(TAG, "scanActiveNotifications: triggered scan of active notifications");
        } else {
            Log.w(TAG, "scanActiveNotifications: NotificationListener service is not running");
        }
        call.resolve();
    }
}

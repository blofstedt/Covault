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
import org.json.JSONArray;
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

    /**
     * Hand over every notification captured while the JS side was not running,
     * then clear the queue.
     *
     * The listener service outlives the WebView, so notifications that arrive
     * with the app closed are broadcast to nobody. Without this the only
     * recovery was scanActiveNotifications(), which fails once the user swipes
     * the notification away. Re-delivery is safe: the JS pipeline dedups.
     */
    @PluginMethod
    public void drainPendingNotifications(PluginCall call) {
        JSObject ret = new JSObject();
        JSArray out = new JSArray();
        try {
            // Clear before returning so a failure downstream cannot loop forever
            // on the same batch. Losing a batch is preferable to wedging capture,
            // and anything still in the shade is recoverable by a scan.
            //
            // Take-and-clear happens under NotificationListener.QUEUE_LOCK so a
            // notification arriving mid-drain cannot be swallowed by the clear.
            // That race was survivable when the bank's notification stayed in
            // the shade; with tray suppression on, the queue is the only copy.
            String stored = NotificationListener.drainPendingQueue(getContext());

            JSONArray queue = new JSONArray(stored);
            for (int i = 0; i < queue.length(); i++) {
                JSONObject json = queue.optJSONObject(i);
                if (json == null) continue;
                JSObject event = new JSObject();
                if (json.has("amount")) {
                    event.put("amount", json.optDouble("amount", 0));
                }
                event.put("vendor", json.optString("vendor", "Unknown Merchant"));
                event.put("source_app", json.optString("source_app", ""));
                event.put("raw_text", json.optString("raw_text", ""));
                event.put("timestamp", json.optLong("timestamp", 0));
                event.put("from_scan", true);
                out.put(event);
            }
            Log.i(TAG, "drainPendingNotifications: returning " + out.length() + " queued notifications");
        } catch (Exception e) {
            Log.e(TAG, "drainPendingNotifications failed", e);
        }
        ret.put("notifications", out);
        call.resolve(ret);
    }

    /**
     * Turn tray suppression on or off.
     *
     * When on, the listener dismisses a bank's own notification once it has
     * durably captured it and posted a Covault notification in its place. See
     * NotificationListener.maybeHideBankNotification for the full gate list —
     * every condition must hold, so the failure mode is always "the bank's
     * notification stays", never "the purchase is lost".
     *
     * Stored in SharedPreferences rather than the web layer's storage because
     * the listener service runs with the WebView dead and has to be able to
     * read it. commit() rather than apply() so a caller that immediately reads
     * it back sees the new value.
     */
    @PluginMethod
    public void setHideBankNotifications(PluginCall call) {
        Boolean hidden = call.getBoolean("hidden");
        if (hidden == null) {
            call.reject("Missing 'hidden'");
            return;
        }
        getContext().getSharedPreferences("covault_prefs", 0)
            .edit()
            .putBoolean(NotificationListener.HIDE_BANK_NOTIFICATIONS_KEY, hidden)
            .commit();
        Log.i(TAG, "setHideBankNotifications: " + hidden);
        call.resolve();
    }

    @PluginMethod
    public void getHideBankNotifications(PluginCall call) {
        // Shared with the listener rather than re-reading the preference here,
        // so the switch can never show a different answer than the one the
        // capture path acts on. See NotificationListener for the default.
        boolean hidden = NotificationListener.isHideBankNotificationsEnabled(getContext());
        JSObject ret = new JSObject();
        ret.put("hidden", hidden);
        call.resolve(ret);
    }

    /**
     * Whether Covault's own capture notification can actually reach the shade.
     *
     * This is the precondition of tray suppression that has no visible symptom
     * of its own. Dismissing a bank alert requires Covault to have put its own
     * notification in the alert's place, so when Android is blocking us —
     * POST_NOTIFICATIONS never granted, or revoked by a reinstall, or the
     * "Captured transactions" channel set to None — every dismissal is skipped
     * while capture itself carries on working. The purchase still lands in
     * Review, the bank's alert still sits in the tray, and the toggle sits
     * there saying "on". Reporting it here is what lets the settings screen
     * say so instead.
     *
     * Creates the channel first: until it exists Android shows no switch for
     * it, so a user sent to fix this would find nothing to fix.
     */
    @PluginMethod
    public void getCaptureNotificationStatus(PluginCall call) {
        NotificationListener.ensureCaptureChannel(getContext());
        boolean canPost = NotificationListener.canPostCaptureNotifications(getContext());
        JSObject ret = new JSObject();
        ret.put("canPost", canPost);
        Log.i(TAG, "getCaptureNotificationStatus: canPost=" + canPost);
        call.resolve(ret);
    }

    /**
     * What happened to each of the last few bank alerts.
     *
     * Suppression has six ways to decline and every one of them looks the same
     * in the tray: the alert stays. Without this the only account of which gate
     * stopped it is logcat, which needs a computer and a cable — so a report of
     * "it still isn't hiding them" costs a release per guess. The settings
     * screen reads these and says which it was.
     */
    @PluginMethod
    public void getCaptureDiagnostics(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("entries", NotificationListener.readCaptureOutcomes(getContext()));
        call.resolve(ret);
    }

    /**
     * Open Android's notification settings for Covault.
     *
     * Where the user goes when the runtime permission prompt is no longer
     * offered — Android stops showing it after a denial, so the only remaining
     * route is the settings page.
     */
    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
            } else {
                intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.fromParts("package", getContext().getPackageName(), null));
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        } catch (Exception e) {
            // Nothing to recover — the user can still reach the page by hand.
            Log.w(TAG, "Could not open notification settings", e);
        }
        call.resolve();
    }

    /**
     * Take the destination of a tapped notification, if there is one, and
     * clear it. MainActivity parks it; the web layer drains it on launch and
     * on resume.
     *
     * Take-and-clear rather than a plain read so a route is acted on exactly
     * once — otherwise every subsequent launch would bounce the user to the
     * same page.
     */
    @PluginMethod
    public void consumePendingRoute(PluginCall call) {
        JSObject ret = new JSObject();
        String route = null;
        try {
            android.content.SharedPreferences prefs =
                getContext().getSharedPreferences("covault_prefs", 0);
            route = prefs.getString(NotificationListener.PENDING_ROUTE_KEY, null);
            if (route != null) {
                prefs.edit().remove(NotificationListener.PENDING_ROUTE_KEY).commit();
                Log.i(TAG, "consumePendingRoute: " + route);
            }
        } catch (Exception e) {
            Log.w(TAG, "consumePendingRoute failed", e);
        }
        ret.put("route", route == null ? "" : route);
        call.resolve(ret);
    }

    /**
     * Hand the home-screen widget a fresh snapshot and redraw it.
     *
     * The widget has no Supabase session — auth lives in the WebView — so this
     * is the only way it gets authoritative data. Writing a snapshot also drops
     * every optimistic delta the notification listener recorded before it, so
     * any capture the JS pipeline went on to reject or dedup stops being
     * counted. See WidgetDeltaStore.
     *
     * `rules` is the user's vendor->category overrides, mirrored so the listener
     * can categorise a capture natively while the app is closed.
     */
    @PluginMethod
    public void updateWidget(PluginCall call) {
        String snapshot = call.getString("snapshot");
        if (snapshot == null) {
            call.reject("Missing 'snapshot'");
            return;
        }
        try {
            WidgetDeltaStore.writeSnapshot(
                getContext(),
                snapshot,
                call.getString("rules"),
                Boolean.TRUE.equals(call.getBoolean("autoFile", false)));
            CovaultWidgetProvider.updateAll(getContext());
        } catch (Exception e) {
            Log.w(TAG, "updateWidget failed", e);
        }
        call.resolve();
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

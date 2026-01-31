package com.covault.app;

import android.app.Application;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;
import android.text.TextUtils;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.PluginMethod;

import org.json.JSONException;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

@CapacitorPlugin(name = "CovaultNotification")
public class CovaultNotificationPlugin extends Plugin {

    private static final String PREFS_NAME = "covault_notification_prefs";
    private static final String KEY_MONITORED_APPS = "monitored_apps";

    // For the guide notification shown while user is in Android settings
    private static final String GUIDE_CHANNEL_ID = "covault_notification_guide";
    private static final int GUIDE_NOTIFICATION_ID = 1001;

    // 1) OPEN THE NOTIFICATION LISTENER SETTINGS (Read / reply / control)
    @PluginMethod
    public void requestAccess(PluginCall call) {
        try {
            Context context = getContext();

            // Show a system notification that tells the user what to do
            showGuideNotification(context);

            // This opens the Notification Listener Settings screen:
            // On most devices it is the "Notification read, reply & control" area.
            Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);

            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to open notification listener settings: " + e.getMessage());
        }
    }

    // 2) CHECK IF OUR NOTIFICATION LISTENER IS ENABLED
    @PluginMethod
    public void isEnabled(PluginCall call) {
        Context context = getContext();
        String pkgName = context.getPackageName();
        String flat = Settings.Secure.getString(
                context.getContentResolver(),
                "enabled_notification_listeners"
        );

        boolean enabled = false;
        if (!TextUtils.isEmpty(flat)) {
            String[] names = flat.split(":");
            for (String name : names) {
                ComponentName cn = ComponentName.unflattenFromString(name);
                if (cn != null && pkgName.equals(cn.getPackageName())) {
                    enabled = true;
                    break;
                }
            }
        }

        JSObject ret = new JSObject();
        ret.put("enabled", enabled);
        call.resolve(ret);
    }

    // 3) LIST INSTALLED APPS (for banking app picker)
    @PluginMethod
    public void getInstalledApps(PluginCall call) {
        Context context = getContext();
        PackageManager pm = context.getPackageManager();
        List<ApplicationInfo> apps = pm.getInstalledApplications(0);

        JSArray result = new JSArray();
        for (ApplicationInfo appInfo : apps) {
            // Only launchable / user apps
            if (pm.getLaunchIntentForPackage(appInfo.packageName) == null) continue;

            JSObject obj = new JSObject();
            obj.put("packageName", appInfo.packageName);
            obj.put("name", pm.getApplicationLabel(appInfo).toString());
            result.put(obj);
        }

        JSObject ret = new JSObject();
        ret.put("apps", result);
        call.resolve(ret);
    }

    // 4) SAVE MONITORED APPS (selected banking apps) IN SHARED PREFS
    @PluginMethod
    public void saveMonitoredApps(PluginCall call) {
        JSArray appsArray = call.getArray("apps");
        if (appsArray == null) appsArray = new JSArray();

        Set<String> set = new HashSet<>();
        for (int i = 0; i < appsArray.length(); i++) {
            try {
                set.add(appsArray.getString(i));
            } catch (JSONException ignored) {}
        }

        Context context = getContext();
        context
                .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putStringSet(KEY_MONITORED_APPS, set)
                .apply();

        call.resolve();
    }

    // 5) LOAD MONITORED APPS
    @PluginMethod
    public void getMonitoredApps(PluginCall call) {
        Context context = getContext();
        Set<String> set = context
                .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getStringSet(KEY_MONITORED_APPS, new HashSet<>());

        JSArray result = new JSArray();
        if (set != null) {
            for (String pkg : set) {
                result.put(pkg);
            }
        }

        JSObject ret = new JSObject();
        ret.put("apps", result);
        call.resolve(ret);
    }

    // ===== INTERNAL: SHOW GUIDE NOTIFICATION WHILE USER IS IN ANDROID SETTINGS =====

    private void showGuideNotification(Context context) {
        createGuideChannelIfNeeded(context);

        // Small text that appears in the Android notification shade while the user is in Settings
        String title = "Enable Covault notification access";
        String body = "In \"Notification read, reply & control\", tap Covault and turn the toggle ON to auto-add transactions.";

        NotificationCompat.Builder builder =
                new NotificationCompat.Builder(context, GUIDE_CHANNEL_ID)
                        .setSmallIcon(context.getApplicationInfo().icon) // uses app icon
                        .setContentTitle(title)
                        .setContentText(body)
                        .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                        .setPriority(NotificationCompat.PRIORITY_HIGH)
                        .setAutoCancel(true);

        NotificationManagerCompat nm = NotificationManagerCompat.from(context);
        nm.notify(GUIDE_NOTIFICATION_ID, builder.build());
    }

    private void createGuideChannelIfNeeded(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationManager nm =
                (NotificationManager) context.getSystemService(Application.NOTIFICATION_SERVICE);
        if (nm == null) return;

        NotificationChannel existing = nm.getNotificationChannel(GUIDE_CHANNEL_ID);
        if (existing != null) return;

        CharSequence name = "Covault Notification Access";
        String description = "Guides you to enable notification access so Covault can auto-add transactions.";
        int importance = NotificationManager.IMPORTANCE_HIGH;

        NotificationChannel channel =
                new NotificationChannel(GUIDE_CHANNEL_ID, name, importance);
        channel.setDescription(description);

        nm.createNotificationChannel(channel);
    }
}

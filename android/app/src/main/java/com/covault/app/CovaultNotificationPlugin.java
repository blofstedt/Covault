package com.covault.app;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.provider.Settings;
import android.text.TextUtils;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.PluginMethod;

import org.json.JSONException;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@CapacitorPlugin(name = "CovaultNotification")
public class CovaultNotificationPlugin extends Plugin {

    private static final String PREFS_NAME = "covault_notification_prefs";
    private static final String KEY_MONITORED_APPS = "monitored_apps";

    // 1) OPEN THE CORRECT ANDROID SETTINGS SCREEN
    @PluginMethod
    public void requestAccess(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to open notification listener settings: " + e.getMessage());
        }
    }

    // 2) CHECK IF OUR LISTENER IS ENABLED
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
}

package com.covault.app;

import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;

@CapacitorPlugin(name = "CovaultNotification")
public class CovaultNotificationPlugin extends Plugin {

    @PluginMethod
    public void requestAccess(PluginCall call) {
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
            if ((app.flags & ApplicationInfo.FLAG_SYSTEM) == 0) {
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
}

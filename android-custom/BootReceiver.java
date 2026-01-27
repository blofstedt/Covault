package com.covault.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Receives boot completed broadcasts to ensure the notification listener
 * service is started after device restart.
 */
public class BootReceiver extends BroadcastReceiver {

    private static final String TAG = "CovaultBootReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;

        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) ||
            "android.intent.action.QUICKBOOT_POWERON".equals(action)) {

            Log.i(TAG, "Boot completed - notification listener will be started by system");

            // The NotificationListenerService is automatically started by the system
            // after boot if the user has granted notification access permission.
            // We don't need to explicitly start it here.

            // However, we can use this to initialize any app-specific state
            // or show a notification reminding the user to open the app.
        }
    }
}

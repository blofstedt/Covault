package com.yourapp;

import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;

public class MyNotificationListenerService extends NotificationListenerService {

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        Log.d("CovaultNL", "Notification posted: " + sbn.getPackageName());
        // You can send broadcasts to JS later if needed
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {
        Log.d("CovaultNL", "Notification removed: " + sbn.getPackageName());
    }
}

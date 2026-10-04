package com.covault.fakebank;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.service.notification.StatusBarNotification;

import org.json.JSONArray;
import org.json.JSONObject;

/** Posts genuine bank-like alerts. No call into Covault, fake listener or JavaScript event. */
public final class BankNotificationReceiver extends BroadcastReceiver {
    private static final String CHANNEL = "fake_bank_purchases";
    private static final String PREFIX = "com.covault.fakebank.";

    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            if (manager == null) throw new IllegalStateException("NotificationManager unavailable");
            String action = intent.getAction();
            if ((PREFIX + "CANCEL_ALL").equals(action)) {
                manager.cancelAll();
                finish("cancelled", new JSONArray());
                return;
            }
            if ((PREFIX + "INSPECT").equals(action)) {
                JSONArray active = new JSONArray();
                for (StatusBarNotification posted : manager.getActiveNotifications()) {
                    JSONObject item = new JSONObject();
                    item.put("id", posted.getId());
                    item.put("title", posted.getNotification().extras.getString(Notification.EXTRA_TITLE));
                    item.put("body", posted.getNotification().extras.getString(Notification.EXTRA_TEXT));
                    item.put("flags", posted.getNotification().flags);
                    item.put("group", posted.getNotification().getGroup());
                    active.put(item);
                }
                finish("active", active);
                return;
            }
            if (!(PREFIX + "POST").equals(action)) throw new IllegalArgumentException("Unknown action");
            if (!manager.areNotificationsEnabled()) {
                throw new IllegalStateException("Grant fake-bank POST_NOTIFICATIONS first");
            }
            manager.createNotificationChannel(new NotificationChannel(
                CHANNEL, "Test bank alerts", NotificationManager.IMPORTANCE_DEFAULT));
            String amount = intent.getStringExtra("amount");
            if (amount == null) amount = "12.34";
            if (!amount.matches("[0-9]+\\.[0-9]{2}")) throw new IllegalArgumentException("Use whole cents");
            String vendor = intent.getStringExtra("vendor");
            if (vendor == null) vendor = "SECOND CUP";
            String scenario = intent.getStringExtra("scenario");
            if (scenario == null) scenario = "purchase";
            String body;
            switch (scenario) {
                case "purchase":
                    body = "You made a purchase at " + vendor + " for $" + amount + ".";
                    break;
                case "income":
                    body = "You received a payroll deposit of $" + amount + ".";
                    break;
                case "declined":
                    body = "Your purchase at " + vendor + " for $" + amount + " was declined.";
                    break;
                case "hold":
                    body = "A pre-authorization hold of $" + amount + " was placed at " + vendor + ".";
                    break;
                default:
                    throw new IllegalArgumentException("Unknown scenario: " + scenario);
            }
            Notification.Builder builder = new Notification.Builder(context, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setAutoCancel(true);
            if (!intent.getBooleanExtra("blank_content", false)) {
                builder.setContentTitle("Covault CI Bank")
                    .setContentText(body)
                    .setStyle(new Notification.BigTextStyle().bigText(body));
            }
            String group = intent.getStringExtra("group");
            if (group != null) builder.setGroup(group);
            if (intent.getBooleanExtra("group_summary", false)) {
                if (group == null || group.isEmpty()) throw new IllegalArgumentException("A summary needs a group");
                builder.setGroupSummary(true);
            }
            manager.notify(intent.getIntExtra("id", 701), builder.build());
            setResultCode(0);
            setResultData(body);
        } catch (Exception error) {
            setResultCode(1);
            setResultData(error.toString());
        }
    }

    private void finish(String message, JSONArray active) {
        Bundle result = new Bundle();
        result.putString("notifications", active.toString());
        setResultExtras(result);
        setResultCode(0);
        setResultData(message);
    }
}

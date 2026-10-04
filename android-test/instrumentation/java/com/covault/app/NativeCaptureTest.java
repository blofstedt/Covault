package com.covault.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.UiAutomation;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;
import android.util.Xml;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.UiDevice;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.xmlpull.v1.XmlPullParser;

import java.io.File;
import java.io.FileInputStream;
import java.lang.reflect.Method;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Real OS delivery through a separately installed bank APK into the production listener. */
@RunWith(AndroidJUnit4.class)
public final class NativeCaptureTest {
    private static final String BANK = "com.covault.fakebank";
    private static final String APP = "com.covault.app.test";
    private static final String COMPONENT = APP + "/com.covault.app.NotificationListener";
    private static final long TIMEOUT_MS = 15000;
    private Context context;
    private UiDevice device;
    private SharedPreferences prefs;
    private NotificationManager notifications;

    @Before
    public void prepareUnopenedApp() throws Exception {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("Never run destructive native tests against the real app", APP, context.getPackageName());
        assertEquals("android-ci", context.getPackageManager().getPackageInfo(APP, 0).versionName);
        device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        prefs = context.getSharedPreferences("covault_prefs", Context.MODE_PRIVATE);
        notifications = context.getSystemService(NotificationManager.class);
        shell("cmd notification disallow_listener " + COMPONENT);
        await("listener disconnect", () -> NotificationListener.getInstance() == null);
        grantPostingPermission(BANK);
        grantPostingPermission(APP);
        cancelBankNotifications();
        notifications.cancelAll();
        await("old Covault replacements removed", () -> notifications.getActiveNotifications().length == 0);
        assertTrue(prefs.edit().clear()
            .putBoolean("monitored_apps_chosen", true)
            .putString("monitored_apps", "[\"com.covault.fakebank\"]")
            .putBoolean("hide_bank_notifications", true)
            .commit());
        seedWidget();
        device.pressHome();
        shell("cmd notification allow_listener " + COMPONENT);
        await("OS listener binding", this::listenerBound);
        InstrumentationRegistry.getInstrumentation().waitForIdleSync();
        assertEquals("No old bank capture may survive into a new case: " + diskQueue(), 0, diskQueue().length());
        assertTrue("Test app must be allowed to post replacements", notifications.areNotificationsEnabled());
    }

    @After
    public void cleanUp() throws Exception {
        if (device == null) return;
        // Restore the actual runtime grant even if the denied-permission assertion failed.
        grantPostingPermission(APP);
        shell("cmd notification disallow_listener " + COMPONENT);
        await("listener cleanup", () -> NotificationListener.getInstance() == null);
        cancelBankNotifications();
        notifications.cancelAll();
        await("replacement cleanup", () -> notifications.getActiveNotifications().length == 0);
        assertTrue(prefs.edit().clear().commit());
    }

    @Test
    public void unopenedPurchaseIsOnDiskBeforeBankAlertDisappears() throws Exception {
        post(101, "purchase", "12.34");
        await("persisted capture and original suppression", () ->
            findCapture(diskQueue(), 12.34) != null && !bankHas(101));
        JSONObject capture = findCapture(diskQueue(), 12.34);
        assertEquals(BANK, capture.getString("source_app"));
        assertEquals("SECOND CUP", capture.getString("vendor"));
        assertEquals("bank", capture.getString("channel"));
        assertEquals("Covault CI Bank", capture.getString("title"));
        assertEquals("You made a purchase at SECOND CUP for $12.34.", capture.getString("body"));
        assertEquals(12.34, capture.getDouble("amount"), 0.000001);
        assertFalse(capture.getBoolean("from_scan"));
        StatusBarNotification replacement = replacementFor(capture.getInt("capture_notification_id"));
        assertNotNull("The user's removed bank alert has a real visible replacement", replacement);
        assertEquals("$12.34 at SECOND CUP", replacement.getNotification().extras.getString(Notification.EXTRA_TITLE));
        assertEquals("Captured — tap to review", replacement.getNotification().extras.getString(Notification.EXTRA_TEXT));
        assertWidget(52.34, 947.66, 1);
        assertEquals(1, new JSONArray(prefs.getString("widget_deltas", "[]")).length());

        // The actual consumer reads the durable batch once, then leaves an empty on-disk queue.
        JSONArray drained = new JSONArray(NotificationListener.drainPendingQueue(context));
        assertEquals(1, drained.length());
        assertEquals(12.34, drained.getJSONObject(0).getDouble("amount"), 0.000001);
        assertEquals(0, diskQueue().length());
        assertEquals(0, new JSONArray(NotificationListener.drainPendingQueue(context)).length());
    }

    @Test
    public void blockedReplacementPermissionKeepsOriginalEvenThoughCaptureIsDurable() throws Exception {
        revokePostingPermissionWithoutKill();
        await("runtime posting permission denied", () ->
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_DENIED && !notifications.areNotificationsEnabled());
        assertEquals(PackageManager.PERMISSION_DENIED,
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS));
        post(201, "purchase", "22.45");
        await("blocked capture outcome", () -> hasOutcome(22.45, "blocked"));
        assertEquals(22.45, findCapture(diskQueue(), 22.45).getDouble("amount"), 0.000001);
        assertTrue("The bank remains the user's only visible record", bankHas(201));
        assertEquals(0, notifications.getActiveNotifications().length);
        assertWidget(62.45, 937.55, 1);

        grantPostingPermission(APP);
        await("posting restored", notifications::areNotificationsEnabled);
        post(202, "purchase", "23.46");
        await("new purchase suppression after permission restored", () ->
            hasOutcome(23.46, "hidden") && !bankHas(202));
        assertTrue(bankHas(201));
        assertEquals(1, notifications.getActiveNotifications().length);
        assertWidget(85.91, 914.09, 2);
    }

    @Test
    public void disabledSourceStaysInTrayAndDoesNotCaptureOrChangeWidget() throws Exception {
        post(301, "purchase", "17.03");
        await("positive control", () -> hasOutcome(17.03, "hidden"));
        assertWidget(57.03, 942.97, 1);
        assertTrue(prefs.edit().putString("monitored_apps", "[]").commit());
        post(302, "purchase", "18.04");
        await("disabled source's original is visible", () -> bankHas(302));
        assertStable("disabled source must stay ignored", () ->
            diskQueue().length() == 1 && bankHas(302)
                && notifications.getActiveNotifications().length == 1);
        assertWidget(57.03, 942.97, 1);
        assertEquals(1, new JSONArray(prefs.getString("widget_deltas", "[]")).length());
        cancelBankNotifications();
        assertTrue(prefs.edit().putString("monitored_apps", "[\"com.covault.fakebank\"]").commit());
        post(303, "purchase", "19.05");
        await("reenabled source captures again", () -> hasOutcome(19.05, "hidden"));
        assertWidget(76.08, 923.92, 2);
    }

    @Test
    public void incomeAndDeclinedChargeAreQueuedQuietlyWithoutWidgetSpending() throws Exception {
        post(401, "income", "31.21");
        await("income processed", () -> hasOutcome(31.21, "income"));
        post(402, "declined", "42.32");
        await("decline processed", () -> hasOutcome(42.32, "failed_charge"));
        assertEquals("Only the posted income and decline belong in this queue: " + diskQueue(), 2, diskQueue().length());
        assertEquals(31.21, findCapture(diskQueue(), 31.21).getDouble("amount"), 0.000001);
        assertEquals(42.32, findCapture(diskQueue(), 42.32).getDouble("amount"), 0.000001);
        assertTrue(bankHas(401));
        assertTrue(bankHas(402));
        assertEquals(0, notifications.getActiveNotifications().length);
        assertEquals(0, new JSONArray(prefs.getString("widget_deltas", "[]")).length());
        assertWidget(40.00, 960.00, 0);
        post(403, "purchase", "54.43");
        await("real spending positive control", () -> hasOutcome(54.43, "hidden"));
        assertWidget(94.43, 905.57, 1);
        assertEquals(1, notifications.getActiveNotifications().length);
    }

    @Test
    public void listenerReconnectRescansWithoutDuplicatingReplacementOrWidgetDelta() throws Exception {
        assertTrue(prefs.edit().putBoolean("hide_bank_notifications", false).commit());
        post(501, "purchase", "55.54");
        await("toggle off leaves original", () -> hasOutcome(55.54, "toggle_off"));
        assertTrue(bankHas(501));
        assertWidget(95.54, 904.46, 1);
        shell("cmd notification disallow_listener " + COMPONENT);
        await("listener stopped", () -> NotificationListener.getInstance() == null);
        assertEquals(55.54, findCapture(diskQueue(), 55.54).getDouble("amount"), 0.000001);
        shell("cmd notification allow_listener " + COMPONENT);
        await("listener reconnected and original rescanned", () ->
            listenerBound() && hasScanCapture(55.54));
        assertEquals(1, notifications.getActiveNotifications().length);
        assertTrue(bankHas(501));
        assertEquals(1, new JSONArray(prefs.getString("widget_deltas", "[]")).length());
        assertWidget(95.54, 904.46, 1);
        JSONArray recovered = new JSONArray(NotificationListener.drainPendingQueue(context));
        assertEquals(2, recovered.length());
        assertEquals(55.54, recovered.getJSONObject(0).getDouble("amount"), 0.000001);
        assertEquals(55.54, recovered.getJSONObject(1).getDouble("amount"), 0.000001);
        assertEquals(0, diskQueue().length());
    }

    @Test
    public void groupSummariesStayIgnoredOnDeliveryAndReconnectButTheirPurchaseCaptures() throws Exception {
        final String group = "covault-ci-purchases";
        postGrouped(601, "66.65", group, true, true);
        await("blank summary really posted", () -> bankHasSummary(601, group, ""));
        assertStable("A blank summary is not a capture", this::noCaptureOrReplacement);
        assertWidget(40.00, 960.00, 0);

        // Keep the grouped child visible through reconnect, so the OS cannot
        // discard an orphan summary before the scan exercises the guard.
        assertTrue(prefs.edit().putBoolean("hide_bank_notifications", false).commit());
        postGrouped(602, "66.65", group, false, false);
        await("grouped child durably captured with suppression off", () ->
            hasOutcome(66.65, "toggle_off") && bankHas(602));
        JSONArray captured = diskQueue();
        assertEquals("The grouped child is captured exactly once: " + captured, 1, captured.length());
        JSONObject purchase = captured.getJSONObject(0);
        assertEquals(66.65, purchase.getDouble("amount"), 0.000001);
        assertEquals("SECOND CUP", purchase.getString("vendor"));
        assertEquals("You made a purchase at SECOND CUP for $66.65.", purchase.getString("body"));
        assertFalse(purchase.getBoolean("from_scan"));
        StatusBarNotification replacement = replacementFor(purchase.getInt("capture_notification_id"));
        assertNotNull("The grouped purchase has a real visible replacement", replacement);
        assertEquals("$66.65 at SECOND CUP", replacement.getNotification().extras.getString(Notification.EXTRA_TITLE));
        assertWidget(106.65, 893.35, 1);

        // An app-provided summary can quote a purchase verbatim. Its flag,
        // rather than its text or amount, identifies it as an aggregate.
        postGrouped(601, "66.65", group, true, false);
        await("purchase-looking summary really posted", () -> bankHasSummary(601, group,
            "You made a purchase at SECOND CUP for $66.65."));
        assertStable("A purchase-looking summary adds nothing to its real child", () ->
            diskQueue().length() == 1
                && notifications.getActiveNotifications().length == 1
                && new JSONArray(prefs.getString("widget_deltas", "[]")).length() == 1);
        JSONArray drained = new JSONArray(NotificationListener.drainPendingQueue(context));
        assertEquals(1, drained.length());
        assertEquals(66.65, drained.getJSONObject(0).getDouble("amount"), 0.000001);
        assertEquals(0, diskQueue().length());

        shell("cmd notification disallow_listener " + COMPONENT);
        await("summary test listener stopped", () -> NotificationListener.getInstance() == null);
        shell("cmd notification allow_listener " + COMPONENT);
        await("summary test listener reconnected and child rescanned", () ->
            listenerBound() && hasScanCapture(66.65));
        InstrumentationRegistry.getInstrumentation().waitForIdleSync();
        assertStable("A reconnect must not backfill a summary", () ->
            bankHasSummary(601, group, "You made a purchase at SECOND CUP for $66.65.")
                && diskQueue().length() == 1 && bankHas(602));
        JSONArray recovered = diskQueue();
        assertEquals(1, recovered.length());
        assertEquals(66.65, recovered.getJSONObject(0).getDouble("amount"), 0.000001);
        assertEquals("SECOND CUP", recovered.getJSONObject(0).getString("vendor"));
        assertTrue(recovered.getJSONObject(0).getBoolean("from_scan"));
        assertEquals(1, notifications.getActiveNotifications().length);
        assertEquals(1, new JSONArray(prefs.getString("widget_deltas", "[]")).length());
        assertWidget(106.65, 893.35, 1);
    }

    private void seedWidget() throws Exception {
        JSONObject snapshot = new JSONObject();
        snapshot.put("updatedAtMs", System.currentTimeMillis() - 1000);
        snapshot.put("monthKey", new SimpleDateFormat("yyyy-MM", Locale.US).format(new Date()));
        snapshot.put("totalSpent", 40.0);
        snapshot.put("remaining", 960.0);
        snapshot.put("totalBudget", 1000.0);
        snapshot.put("pendingReview", 0);
        snapshot.put("slices", new JSONArray("[{\"name\":\"Other\",\"amount\":40,\"color\":\"#64748B\"}]"));
        WidgetDeltaStore.writeSnapshot(context, snapshot.toString(), "[]", false);
    }

    private void grantPostingPermission(String packageName) {
        InstrumentationRegistry.getInstrumentation().getUiAutomation()
            .grantRuntimePermission(packageName, Manifest.permission.POST_NOTIFICATIONS);
    }

    private void revokePostingPermissionWithoutKill() throws Exception {
        // Android 13+ stores app-wide notification consent as a runtime grant.
        // Changing the legacy POST_NOTIFICATION appop does not revoke that grant.
        // This is the platform's CTS test hook, not a replacement for production code.
        // Android's instrumentation launcher permits @TestApi access by default.
        UiAutomation automation = InstrumentationRegistry.getInstrumentation().getUiAutomation();
        Object manager = context.getSystemService("permission");
        assertNotNull("Android PermissionManager is required for the runtime-denial test", manager);
        int userId = Integer.parseInt(device.executeShellCommand("am get-current-user").trim());
        automation.adoptShellPermissionIdentity(
            "android.permission.REVOKE_POST_NOTIFICATIONS_WITHOUT_KILL",
            "android.permission.REVOKE_RUNTIME_PERMISSIONS");
        try {
            // @TestApi is excluded from the public compile SDK. Reflect only this
            // exact API, which revokes POST_NOTIFICATIONS without killing our runner.
            Method revoke = manager.getClass().getMethod(
                "revokePostNotificationPermissionWithoutKillForTest", String.class, int.class);
            revoke.invoke(manager, APP, userId);
        } catch (ReflectiveOperationException error) {
            throw new AssertionError("The emulator must expose Android's no-kill notification "
                + "permission test hook with instrumentation @TestApi access", error);
        } finally {
            // Check and capture as the real target UID, without adopted shell permissions.
            automation.dropShellPermissionIdentity();
        }
    }

    private void assertWidget(double spent, double remaining, int pending) throws Exception {
        await("widget snapshot reaches expected total", () -> {
            JSONObject merged = WidgetDeltaStore.mergeInto(context, WidgetDeltaStore.readSnapshot(context));
            return merged != null && Math.abs(merged.getDouble("totalSpent") - spent) < 0.000001;
        });
        JSONObject merged = WidgetDeltaStore.mergeInto(context, WidgetDeltaStore.readSnapshot(context));
        assertEquals(spent, merged.getDouble("totalSpent"), 0.000001);
        assertEquals(remaining, merged.getDouble("remaining"), 0.000001);
        assertEquals(pending, merged.getInt("pendingReview"));
    }

    private boolean listenerBound() {
        NotificationListener listener = NotificationListener.getInstance();
        if (listener == null) return false;
        try {
            return listener.getActiveNotifications() != null;
        } catch (Exception notBoundYet) {
            return false;
        }
    }

    private void post(int id, String scenario, String amount) throws Exception {
        Bundle args = new Bundle();
        args.putInt("id", id);
        args.putString("scenario", scenario);
        args.putString("amount", amount);
        bankCommand("POST", args);
    }

    private void postGrouped(int id, String amount, String group, boolean summary, boolean blank) throws Exception {
        Bundle args = new Bundle();
        args.putInt("id", id);
        args.putString("scenario", "purchase");
        args.putString("amount", amount);
        args.putString("group", group);
        args.putBoolean("group_summary", summary);
        args.putBoolean("blank_content", blank);
        bankCommand("POST", args);
    }

    private boolean noCaptureOrReplacement() throws Exception {
        return diskQueue().length() == 0
            && notifications.getActiveNotifications().length == 0
            && new JSONArray(prefs.getString("widget_deltas", "[]")).length() == 0;
    }

    private void cancelBankNotifications() throws Exception {
        bankCommand("CANCEL_ALL", null);
        // cancelAll queues work in Android's notification service. The ordered
        // receiver finishing does not mean the old alerts have been removed.
        await("fake-bank cancellations completed", () -> bankNotifications().length() == 0);
        InstrumentationRegistry.getInstrumentation().waitForIdleSync();
    }

    private JSONArray bankNotifications() throws Exception {
        return new JSONArray(bankCommand("INSPECT", null).getString("notifications", "[]"));
    }

    private boolean bankHasSummary(int id, String group, String body) throws Exception {
        JSONArray active = bankNotifications();
        for (int i = 0; i < active.length(); i++) {
            JSONObject item = active.getJSONObject(i);
            if (item.getInt("id") == id
                && (item.getInt("flags") & Notification.FLAG_GROUP_SUMMARY) != 0
                && group.equals(item.optString("group"))
                && body.equals(item.optString("body", ""))) return true;
        }
        return false;
    }

    private boolean bankHas(int id) throws Exception {
        JSONArray active = bankNotifications();
        for (int i = 0; i < active.length(); i++) {
            if (active.getJSONObject(i).getInt("id") == id) return true;
        }
        return false;
    }

    private Bundle bankCommand(String action, Bundle args) throws Exception {
        Intent intent = new Intent(BANK + "." + action)
            .setClassName(BANK, BANK + ".BankNotificationReceiver")
            .addFlags(Intent.FLAG_INCLUDE_STOPPED_PACKAGES);
        if (args != null) intent.putExtras(args);
        CountDownLatch completed = new CountDownLatch(1);
        AtomicReference<Bundle> result = new AtomicReference<>();
        AtomicReference<String> error = new AtomicReference<>();
        context.sendOrderedBroadcast(intent, null, new BroadcastReceiver() {
            @Override
            public void onReceive(Context ignored, Intent received) {
                if (getResultCode() != 0) error.set("code " + getResultCode() + ": " + getResultData());
                result.set(getResultExtras(true));
                completed.countDown();
            }
        }, new Handler(Looper.getMainLooper()), -1, null, null);
        assertTrue("Fake bank receiver completed: " + action, completed.await(10, TimeUnit.SECONDS));
        if (error.get() != null) fail("Fake bank command failed: " + error.get());
        return result.get();
    }

    private StatusBarNotification replacementFor(int id) {
        for (StatusBarNotification item : notifications.getActiveNotifications()) {
            if (item.getId() == id) return item;
        }
        return null;
    }

    private JSONArray diskQueue() throws Exception {
        // Read actual disk bytes, not SharedPreferences' in-memory cache.
        File file = new File(context.getApplicationInfo().dataDir, "shared_prefs/covault_prefs.xml");
        try (FileInputStream input = new FileInputStream(file)) {
            XmlPullParser parser = Xml.newPullParser();
            parser.setInput(input, "UTF-8");
            int event;
            while ((event = parser.next()) != XmlPullParser.END_DOCUMENT) {
                if (event == XmlPullParser.START_TAG && "string".equals(parser.getName())
                    && "pending_notifications".equals(parser.getAttributeValue(null, "name"))) {
                    return new JSONArray(parser.nextText());
                }
            }
        }
        return new JSONArray();
    }

    private JSONObject findCapture(JSONArray queue, double amount) throws Exception {
        for (int i = 0; i < queue.length(); i++) {
            JSONObject row = queue.getJSONObject(i);
            if (Math.abs(row.optDouble("amount", -1) - amount) < 0.000001) return row;
        }
        return null;
    }

    private boolean hasScanCapture(double amount) throws Exception {
        JSONArray queue = diskQueue();
        for (int i = 0; i < queue.length(); i++) {
            JSONObject row = queue.getJSONObject(i);
            if (Math.abs(row.optDouble("amount", -1) - amount) < 0.000001 && row.optBoolean("from_scan")) return true;
        }
        return false;
    }

    private boolean hasOutcome(double amount, String outcome) throws Exception {
        JSONArray outcomes = new JSONArray(prefs.getString("capture_outcomes", "[]"));
        for (int i = 0; i < outcomes.length(); i++) {
            JSONObject row = outcomes.getJSONObject(i);
            if (Math.abs(row.optDouble("amount", -1) - amount) < 0.000001
                && outcome.equals(row.getString("outcome"))) return true;
        }
        return false;
    }

    private void shell(String command) throws Exception {
        String output = device.executeShellCommand(command);
        assertFalse("ADB command rejected: " + output, output.contains("Exception") || output.contains("Error:"));
    }

    private void await(String description, CheckedCondition condition) throws Exception {
        long end = SystemClock.elapsedRealtime() + TIMEOUT_MS;
        Exception lastError = null;
        while (SystemClock.elapsedRealtime() < end) {
            try {
                if (condition.check()) return;
            } catch (Exception transientError) {
                lastError = transientError;
            }
            SystemClock.sleep(100);
        }
        fail("Timed out waiting for " + description + (lastError == null ? "" : ": " + lastError));
    }

    private void assertStable(String description, CheckedCondition condition) throws Exception {
        long end = SystemClock.elapsedRealtime() + 2000;
        do {
            assertTrue(description, condition.check());
            SystemClock.sleep(100);
        } while (SystemClock.elapsedRealtime() < end);
    }

    private interface CheckedCondition {
        boolean check() throws Exception;
    }
}

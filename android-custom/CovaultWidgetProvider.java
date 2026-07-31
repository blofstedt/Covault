package com.covault.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.util.Log;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.util.Calendar;

/**
 * The Covault home-screen widget: this month's spending as a donut.
 *
 * Everything visual is a Bitmap drawn by WidgetRenderer and set into a single
 * ImageView. RemoteViews cannot host a WebView, so the app's d3 chart is
 * unreachable from here and the donut is drawn natively instead.
 */
public class CovaultWidgetProvider extends AppWidgetProvider {

    private static final String TAG = "CovaultWidget";
    private static final String ACTION_MIDNIGHT = "com.covault.app.WIDGET_MIDNIGHT";

    /**
     * RemoteViews cross a Binder transaction with a hard size ceiling (~1MB in
     * practice). A 4x2 widget at xxhdpi is roughly 750x330, which as ARGB_8888
     * is ~990KB — over the line on a large or high-density device, where it
     * throws and the launcher shows "Problem loading widget". So the bitmap is
     * clamped and the ImageView's fitCenter scales it back up. A donut is
     * smooth curves and short text; the downscale is invisible.
     */
    private static final int MAX_BITMAP_W = 720;
    private static final int MAX_BITMAP_H = 480;
    private static final float MAX_DENSITY = 2.0f;

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            renderOne(context, manager, id);
        }
        scheduleMidnightRedraw(context);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager,
                                          int appWidgetId, Bundle newOptions) {
        // Resize: the bitmap is sized from the widget's own dp bounds, so it has
        // to be redrawn or it stretches.
        renderOne(context, manager, appWidgetId);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (intent != null && ACTION_MIDNIGHT.equals(intent.getAction())) {
            updateAll(context);
        }
    }

    @Override
    public void onDisabled(Context context) {
        // Last widget removed — stop waking the device for a surface that no
        // longer exists.
        cancelMidnightRedraw(context);
    }

    /** Redraw every placed widget. Called by the plugin and by the midnight alarm. */
    static void updateAll(Context context) {
        try {
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            int[] ids = manager.getAppWidgetIds(new ComponentName(context, CovaultWidgetProvider.class));
            if (ids == null || ids.length == 0) return;
            for (int id : ids) {
                renderOne(context, manager, id);
            }
            scheduleMidnightRedraw(context);
        } catch (Exception e) {
            Log.w(TAG, "updateAll failed", e);
        }
    }

    private static void renderOne(Context context, AppWidgetManager manager, int appWidgetId) {
        try {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_covault);

            JSONObject snapshot = WidgetDeltaStore.readSnapshot(context);
            if (snapshot != null) {
                snapshot = staleMonthGuard(WidgetDeltaStore.mergeInto(context, snapshot));
            }
            if (snapshot == null) {
                // Never opened, or the stored JSON is unreadable. An empty
                // month renders as a ring plus "No spending yet", which is a
                // better first impression than a blank tile.
                snapshot = emptySnapshot();
            }

            int[] size = bitmapSize(context, manager, appWidgetId);
            boolean systemDark = (context.getResources().getConfiguration().uiMode
                & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;

            Bitmap bitmap = WidgetRenderer.render(context, snapshot, size[0], size[1], systemDark);
            views.setImageViewBitmap(R.id.widget_canvas, bitmap);
            views.setOnClickPendingIntent(R.id.widget_root, launchIntent(context));

            manager.updateAppWidget(appWidgetId, views);
        } catch (Exception e) {
            // A throw here surfaces to the user as "Problem loading widget", so
            // swallow and leave the previous frame up.
            Log.w(TAG, "render failed for " + appWidgetId, e);
        }
    }

    /**
     * If the snapshot describes a month that has since ended, show an empty new
     * month rather than last month's figures under this month's name.
     */
    private static JSONObject staleMonthGuard(JSONObject snapshot) {
        if (snapshot == null) return null;
        String snapshotMonth = snapshot.optString("monthKey", "");
        String currentMonth = WidgetDeltaStore.monthKeyOf(System.currentTimeMillis());
        if (snapshotMonth.isEmpty() || snapshotMonth.equals(currentMonth)) return snapshot;
        return emptySnapshot();
    }

    private static JSONObject emptySnapshot() {
        JSONObject o = new JSONObject();
        try {
            long now = System.currentTimeMillis();
            Calendar cal = Calendar.getInstance();
            cal.setTimeInMillis(now);
            String[] names = {
                "January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December",
            };
            o.put("monthKey", WidgetDeltaStore.monthKeyOf(now));
            o.put("monthLabel", names[cal.get(Calendar.MONTH)]);
            o.put("totalSpent", 0);
            o.put("remaining", 0);
            o.put("slices", new org.json.JSONArray());
            o.put("updatedAtMs", now);
        } catch (Exception e) {
            // An empty JSONObject still renders — every read below has a default.
        }
        return o;
    }

    /** Widget bounds in px, clamped to keep the RemoteViews transaction small. */
    private static int[] bitmapSize(Context context, AppWidgetManager manager, int appWidgetId) {
        int wDp = 250;
        int hDp = 110;
        try {
            Bundle options = manager.getAppWidgetOptions(appWidgetId);
            if (options != null) {
                int w = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
                int h = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
                if (w > 0) wDp = w;
                if (h > 0) hDp = h;
            }
        } catch (Exception e) {
            // defaults
        }
        float density = Math.min(context.getResources().getDisplayMetrics().density, MAX_DENSITY);
        int w = Math.min((int) (wDp * density), MAX_BITMAP_W);
        int h = Math.min((int) (hDp * density), MAX_BITMAP_H);
        return new int[] { Math.max(w, 120), Math.max(h, 80) };
    }

    private static PendingIntent launchIntent(Context context) {
        Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (open == null) open = new Intent(context, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(context, 0, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    // ── Midnight redraw ───────────────────────────────────────────────────
    //
    // The snapshot only changes when the app writes it, so updatePeriodMillis is
    // 0 — a polling interval would wake the device to redraw identical pixels.
    // The one thing that does change on its own is the date, so a single
    // inexact alarm at the next local midnight covers month rollover. Inexact
    // (AlarmManager.set) needs no special permission, and being a few minutes
    // late on the 1st is irrelevant.

    private static void scheduleMidnightRedraw(Context context) {
        try {
            AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            Calendar next = Calendar.getInstance();
            next.add(Calendar.DAY_OF_YEAR, 1);
            next.set(Calendar.HOUR_OF_DAY, 0);
            next.set(Calendar.MINUTE, 1);
            next.set(Calendar.SECOND, 0);
            next.set(Calendar.MILLISECOND, 0);
            am.set(AlarmManager.RTC, next.getTimeInMillis(), midnightIntent(context));
        } catch (Exception e) {
            Log.w(TAG, "could not schedule midnight redraw", e);
        }
    }

    private static void cancelMidnightRedraw(Context context) {
        try {
            AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (am != null) am.cancel(midnightIntent(context));
        } catch (Exception e) {
            Log.w(TAG, "could not cancel midnight redraw", e);
        }
    }

    private static PendingIntent midnightIntent(Context context) {
        Intent intent = new Intent(context, CovaultWidgetProvider.class);
        intent.setAction(ACTION_MIDNIGHT);
        return PendingIntent.getBroadcast(context, 1, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}

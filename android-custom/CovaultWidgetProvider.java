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
    /** Open one category on the donut, or close whatever is open. */
    private static final String ACTION_FOCUS = "com.covault.app.WIDGET_FOCUS";
    private static final String EXTRA_FOCUS = "focus";
    private static final String FOCUS_PREF = "widget_focus";

    /**
     * RemoteViews cross a Binder transaction with a hard size ceiling (~1MB in
     * practice). A 4x2 widget at xxhdpi is roughly 750x330, which as ARGB_8888
     * is ~990KB — over the line on a large or high-density device, where it
     * throws and the launcher shows "Problem loading widget". So the bitmap is
     * clamped and the ImageView's fitCenter scales it back up. A donut is
     * smooth curves and short text; the downscale is invisible.
     *
     * The budget is a pixel COUNT, not a width and a height. It was a pair of
     * independent caps, 720x480, which multiply out to 1.38MB — 40% past the
     * ceiling this comment describes, reachable by anyone who stretched the
     * widget, and failing in exactly the way the clamp exists to prevent.
     * Capping the area also keeps the bitmap's aspect ratio equal to the
     * widget's, which is what stops `fitCenter` letterboxing it.
     */
    private static final int MAX_BITMAP_PIXELS = 180_000;   // ~720KB as ARGB_8888
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
            return;
        }
        if (intent != null && ACTION_FOCUS.equals(intent.getAction())) {
            int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,
                AppWidgetManager.INVALID_APPWIDGET_ID);
            if (id == AppWidgetManager.INVALID_APPWIDGET_ID) return;
            String category = intent.getStringExtra(EXTRA_FOCUS);
            // Tapping the slice that is already open closes it, so the band
            // itself is a toggle and not only the hole in the middle.
            String current = readFocus(context, id);
            String next = (category == null || category.equals(current)) ? "" : category;
            writeFocus(context, id, next);
            try {
                renderOne(context, AppWidgetManager.getInstance(context), id);
            } catch (Exception e) {
                Log.w(TAG, "focus redraw failed", e);
            }
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

            // A category is only ever open on the widget it was opened on, and
            // only while the figures it was opened against still stand. A fresh
            // snapshot clears it: the list behind it has changed, and leaving
            // it open would show yesterday's purchases under today's ring.
            String focus = readFocus(context, appWidgetId);
            if (!focus.isEmpty()) {
                try {
                    snapshot.put("focus", focus);
                } catch (Exception e) {
                    Log.w(TAG, "could not apply focus", e);
                }
            }

            float[] spec = bitmapSpec(context, manager, appWidgetId);
            boolean systemDark = (context.getResources().getConfiguration().uiMode
                & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;

            Bitmap bitmap = WidgetRenderer.render(
                context, snapshot, (int) spec[0], (int) spec[1], systemDark, spec[2]);
            views.setImageViewBitmap(R.id.widget_canvas, bitmap);

            // The card itself is deliberately not a button. It used to open
            // Covault from anywhere, which meant every attempt to reach a
            // category row or the review pill that missed by a few pixels
            // launched the app instead of doing the thing that was aimed at.
            // The things worth opening now say so individually.

            // Category rows open Covault at that budget, expanded.
            placeLegendHits(context, views, spec);
            // The donut's bands open a category on the widget itself, and the
            // hole in the middle closes it again.
            placeDonutHits(context, views, spec, appWidgetId);

            // Everything on screen is one bitmap, so a screen reader has
            // nothing to walk. Without this it announces a fixed sentence about
            // spending by category and never a single figure.
            views.setContentDescription(R.id.widget_canvas, describe(snapshot));

            // The pill looks like a badge you can act on, so make it one. It
            // lands on Review, the same place a tapped capture notification
            // goes. Hidden when there is nothing waiting, so the rest of the
            // widget keeps its ordinary tap.
            int pending = snapshot.optInt("pendingReview", 0);
            if (pending > 0) {
                views.setViewVisibility(R.id.widget_review_hit, android.view.View.VISIBLE);
                views.setOnClickPendingIntent(R.id.widget_review_hit, reviewIntent(context));
            } else {
                views.setViewVisibility(R.id.widget_review_hit, android.view.View.GONE);
            }

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
    /**
     * The bitmap to draw into: width, height, and the pixels-per-dp actually
     * used, which the renderer needs to size text in real units.
     *
     * The dp bounds are read orientation-aware. AppWidgetManager reports a min
     * and a max for each axis, and which one is the current cell depends on
     * rotation — taking MIN_WIDTH with MAX_HEIGHT is right in portrait and
     * wrong in landscape, where it produced a bitmap of the wrong shape that
     * `fitCenter` then floated in the middle of the tile with transparent
     * bands down the sides.
     */
    private static float[] bitmapSpec(Context context, AppWidgetManager manager, int appWidgetId) {
        boolean landscape = context.getResources().getConfiguration().orientation
            == Configuration.ORIENTATION_LANDSCAPE;
        int wDp = 250;
        int hDp = 110;
        try {
            Bundle options = manager.getAppWidgetOptions(appWidgetId);
            if (options != null) {
                int w = options.getInt(landscape
                    ? AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH
                    : AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
                int h = options.getInt(landscape
                    ? AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT
                    : AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
                if (w > 0) wDp = w;
                if (h > 0) hDp = h;
            }
        } catch (Exception e) {
            // defaults
        }

        float dp = Math.min(context.getResources().getDisplayMetrics().density, MAX_DENSITY);
        // Scale both axes together when over budget, so the bitmap keeps the
        // widget's aspect ratio and the text keeps a known size in dp.
        float area = (wDp * dp) * (hDp * dp);
        if (area > MAX_BITMAP_PIXELS) {
            dp *= (float) Math.sqrt(MAX_BITMAP_PIXELS / area);
        }

        int w = Math.max(120, Math.round(wDp * dp));
        int h = Math.max(80, Math.round(hDp * dp));
        return new float[] { w, h, dp };
    }

    /** The legend hit views, in the order the renderer draws the rows. */
    private static final int[] LEGEND_HIT_IDS = {
        R.id.widget_legend_hit_0,
        R.id.widget_legend_hit_1,
        R.id.widget_legend_hit_2,
        R.id.widget_legend_hit_3,
    };

    /**
     * Lay an invisible tap target over each legend row.
     *
     * The rows are pixels in a bitmap, so the launcher cannot hit-test them —
     * a target only lands in the right place if it is positioned from the same
     * geometry that drew the row. The renderer records that; this scales it
     * from bitmap pixels into the widget's own dp and sets it on the view.
     *
     * The scale matters: the bitmap is drawn smaller than the widget on purpose
     * (see MAX_BITMAP_PIXELS) and `fitCenter` stretches it back up, so bitmap
     * coordinates are not widget coordinates and a target placed with the raw
     * numbers would sit above and left of the row it belongs to.
     *
     * Runtime positioning needs setViewLayoutMargin, which is API 31+. Below
     * that the targets stay hidden and the rows are simply not tappable —
     * the widget keeps working, it just does less.
     */
    private static void placeLegendHits(Context context, RemoteViews views, float[] spec) {
        for (int id : LEGEND_HIT_IDS) {
            views.setViewVisibility(id, android.view.View.GONE);
        }
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.S) return;

        java.util.List<WidgetRenderer.HitRect> hits = WidgetRenderer.lastLegendHits();
        if (hits.isEmpty()) return;

        // Bitmap px -> widget dp. spec[2] is the pixels-per-dp the bitmap was
        // drawn at, which already carries the clamp, so dividing by it lands
        // back in the dp the launcher lays the views out in.
        float pxPerDp = spec[2];
        if (pxPerDp <= 0) return;

        int count = Math.min(hits.size(), LEGEND_HIT_IDS.length);
        for (int i = 0; i < count; i++) {
            WidgetRenderer.HitRect hit = hits.get(i);
            int id = LEGEND_HIT_IDS[i];
            float leftDp = hit.left / pxPerDp;
            float topDp = hit.top / pxPerDp;
            float widthDp = (hit.right - hit.left) / pxPerDp;
            float heightDp = (hit.bottom - hit.top) / pxPerDp;
            if (widthDp <= 0 || heightDp <= 0) continue;

            views.setViewLayoutMargin(id, RemoteViews.MARGIN_START, leftDp,
                android.util.TypedValue.COMPLEX_UNIT_DIP);
            views.setViewLayoutMargin(id, RemoteViews.MARGIN_TOP, topDp,
                android.util.TypedValue.COMPLEX_UNIT_DIP);
            views.setViewLayoutWidth(id, widthDp, android.util.TypedValue.COMPLEX_UNIT_DIP);
            views.setViewLayoutHeight(id, heightDp, android.util.TypedValue.COMPLEX_UNIT_DIP);
            views.setViewVisibility(id, android.view.View.VISIBLE);
            views.setOnClickPendingIntent(id, budgetIntent(context, hit.category, i));
        }
    }

    /**
     * Open Covault with this budget expanded.
     *
     * Carried the same way the review destination is — parked by MainActivity
     * for the web layer to collect — so there is one mechanism for "open the
     * app somewhere specific" rather than a second one that can rot separately.
     *
     * The request code has to differ per category. Two PendingIntents that
     * differ only in their extras are the same intent as far as the system is
     * concerned, so without this every row would open whichever budget was
     * registered first. Offset past the codes the launch and review intents
     * already use.
     */
    /**
     * Lay a tap target on each of the donut's bands, and one in the hole.
     *
     * A rectangle cannot follow an arc, so each target sits where the renderer
     * draws that slice's icon chip — the middle of its band. Targets that would
     * overlap an earlier one are dropped rather than shrunk: a box straddling
     * two slices opens the wrong category, which is worse than a slice you have
     * to reach from the list instead.
     */
    private static void placeDonutHits(Context context, RemoteViews views, float[] spec,
                                       int appWidgetId) {
        for (int id : ARC_HIT_IDS) {
            views.setViewVisibility(id, android.view.View.GONE);
        }
        views.setViewVisibility(R.id.widget_centre_hit, android.view.View.GONE);
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.S) return;

        float pxPerDp = spec[2];
        if (pxPerDp <= 0) return;

        WidgetRenderer.HitRect centre = WidgetRenderer.lastCentreHit();
        if (centre != null) {
            place(views, R.id.widget_centre_hit, centre, pxPerDp);
            views.setOnClickPendingIntent(R.id.widget_centre_hit,
                focusIntent(context, appWidgetId, "", 0));
            return;
        }

        java.util.List<WidgetRenderer.HitRect> arcs = WidgetRenderer.lastArcHits();
        java.util.List<WidgetRenderer.HitRect> placed = new java.util.ArrayList<>();
        int slot = 0;
        for (WidgetRenderer.HitRect arc : arcs) {
            if (slot >= ARC_HIT_IDS.length) break;
            if (overlapsAny(arc, placed)) continue;
            place(views, ARC_HIT_IDS[slot], arc, pxPerDp);
            views.setOnClickPendingIntent(ARC_HIT_IDS[slot],
                focusIntent(context, appWidgetId, arc.category, slot + 1));
            placed.add(arc);
            slot++;
        }
    }

    private static final int[] ARC_HIT_IDS = {
        R.id.widget_arc_hit_0,
        R.id.widget_arc_hit_1,
        R.id.widget_arc_hit_2,
        R.id.widget_arc_hit_3,
        R.id.widget_arc_hit_4,
        R.id.widget_arc_hit_5,
    };

    private static boolean overlapsAny(WidgetRenderer.HitRect candidate,
                                       java.util.List<WidgetRenderer.HitRect> placed) {
        for (WidgetRenderer.HitRect other : placed) {
            boolean apart = candidate.right <= other.left || candidate.left >= other.right
                || candidate.bottom <= other.top || candidate.top >= other.bottom;
            if (!apart) return true;
        }
        return false;
    }

    /** Position one target, converting bitmap pixels into the widget's dp. */
    private static void place(RemoteViews views, int id, WidgetRenderer.HitRect hit,
                              float pxPerDp) {
        float widthDp = (hit.right - hit.left) / pxPerDp;
        float heightDp = (hit.bottom - hit.top) / pxPerDp;
        if (widthDp <= 0 || heightDp <= 0) return;
        views.setViewLayoutMargin(id, RemoteViews.MARGIN_START, hit.left / pxPerDp,
            android.util.TypedValue.COMPLEX_UNIT_DIP);
        views.setViewLayoutMargin(id, RemoteViews.MARGIN_TOP, hit.top / pxPerDp,
            android.util.TypedValue.COMPLEX_UNIT_DIP);
        views.setViewLayoutWidth(id, widthDp, android.util.TypedValue.COMPLEX_UNIT_DIP);
        views.setViewLayoutHeight(id, heightDp, android.util.TypedValue.COMPLEX_UNIT_DIP);
        views.setViewVisibility(id, android.view.View.VISIBLE);
    }

    /**
     * Open or close a category, on this widget only.
     *
     * A broadcast back to the provider rather than an activity launch: opening
     * a category happens on the home screen and must not pull the app up.
     *
     * The request code has to be unique per target for the same reason the
     * budget intents' are — extras alone do not distinguish two PendingIntents
     * — and it also has to carry the widget id, or two placed widgets would
     * share one intent and open a category on each other.
     */
    private static PendingIntent focusIntent(Context context, int appWidgetId,
                                             String category, int slot) {
        Intent intent = new Intent(context, CovaultWidgetProvider.class);
        intent.setAction(ACTION_FOCUS);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
        intent.putExtra(EXTRA_FOCUS, category);
        return PendingIntent.getBroadcast(context, (appWidgetId * 16) + 100 + slot, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /**
     * Close any opened category, on every placed widget.
     *
     * Called when the app writes a new snapshot. An opened category is a view
     * of figures that have just been replaced — leaving it up would show the
     * previous load's purchases inside a ring drawn from the new one, and the
     * user has no way to tell that has happened.
     */
    static void clearFocus(Context context) {
        try {
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            int[] ids = manager.getAppWidgetIds(
                new ComponentName(context, CovaultWidgetProvider.class));
            if (ids == null || ids.length == 0) return;
            android.content.SharedPreferences.Editor editor =
                context.getSharedPreferences("covault_prefs", 0).edit();
            for (int id : ids) editor.remove(FOCUS_PREF + "_" + id);
            editor.apply();
        } catch (Exception e) {
            Log.w(TAG, "could not clear the widget focus", e);
        }
    }

    private static String readFocus(Context context, int appWidgetId) {
        try {
            return context.getSharedPreferences("covault_prefs", 0)
                .getString(FOCUS_PREF + "_" + appWidgetId, "");
        } catch (Exception e) {
            return "";
        }
    }

    private static void writeFocus(Context context, int appWidgetId, String category) {
        try {
            context.getSharedPreferences("covault_prefs", 0)
                .edit()
                .putString(FOCUS_PREF + "_" + appWidgetId, category == null ? "" : category)
                .apply();
        } catch (Exception e) {
            Log.w(TAG, "could not store the widget focus", e);
        }
    }

    private static PendingIntent budgetIntent(Context context, String category, int index) {
        Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (open == null) open = new Intent(context, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        open.putExtra(NotificationListener.ROUTE_EXTRA,
            NotificationListener.ROUTE_BUDGET_PREFIX + category);
        return PendingIntent.getActivity(context, 10 + index, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /**
     * The same launch, carrying the destination MainActivity parks for the web
     * layer to collect — the mechanism a tapped capture notification already
     * uses, so Review is reached the same way from both.
     *
     * A distinct request code: two PendingIntents that differ only in their
     * extras are "the same" as far as the system is concerned, and the second
     * would otherwise quietly reuse the first and land on the dashboard.
     */
    private static PendingIntent reviewIntent(Context context) {
        Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (open == null) open = new Intent(context, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        open.putExtra(NotificationListener.ROUTE_EXTRA, NotificationListener.ROUTE_REVIEW);
        return PendingIntent.getActivity(context, 1, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** What a screen reader says, since the widget itself is a single image. */
    private static String describe(JSONObject snapshot) {
        StringBuilder out = new StringBuilder();
        out.append(snapshot.optString("monthLabel", "This month")).append(". ");
        out.append(WidgetRenderer.money(snapshot.optDouble("totalSpent", 0))).append(" spent");

        double remaining = snapshot.optDouble("remaining", 0);
        if (remaining < 0) {
            out.append(", ").append(WidgetRenderer.money(-remaining)).append(" over budget");
        } else {
            out.append(", ").append(WidgetRenderer.money(remaining)).append(" left");
        }

        int pending = snapshot.optInt("pendingReview", 0);
        if (pending > 0) out.append(". ").append(pending).append(" to review");
        return out.append('.').toString();
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

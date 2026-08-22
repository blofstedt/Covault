package com.covault.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.BroadcastReceiver;
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
            BroadcastReceiver.PendingResult pending = null;
            try {
                pending = goAsync();
            } catch (Exception e) {
                // Without it the frames may stop early; the settled state is
                // already stored, so the widget still ends up correct.
                Log.w(TAG, "could not hold the broadcast open", e);
            }
            try {
                animateFocus(context, id, current, next, pending);
            } catch (Exception e) {
                Log.w(TAG, "focus animation failed", e);
                if (pending != null) pending.finish();
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

    /**
     * The morph between the whole month and one category.
     *
     * Matches the app's own interaction clock — 320ms on
     * cubic-bezier(0.32, 0.72, 0.24, 1) — because opening a category on the
     * widget and opening a budget in the app are the same gesture and should
     * not run at two speeds.
     */
    private static final long FOCUS_ANIM_MS = 320L;
    /**
     * The cadence frames are aimed at, which works out to ten of them inside
     * the 320ms. Not a promise: every frame is a full bitmap crossing a Binder
     * transaction, and if one takes longer than this the run drops the slot it
     * missed rather than posting it late. That is the whole point of driving
     * this from the clock — the morph lands at 320ms on a busy phone as well
     * as an idle one, just with fewer pictures in between.
     *
     * It used to post all nine frames up front at fixed delays. Each one then
     * re-read the snapshot from storage and re-merged the pending captures
     * before drawing, so on a phone doing anything else the renders ran long,
     * queued behind each other, and the tail of the morph crawled — which is
     * what "not smooth" looked like.
     */
    private static final long FOCUS_FRAME_MS = 32L;
    /**
     * Mid-morph frames are drawn at this fraction of the widget's size and
     * scaled back up by the ImageView, which is the difference between this
     * animation costing 6MB of Binder traffic and costing 2.
     */
    private static final float FOCUS_ANIM_SCALE = 0.62f;
    /**
     * Where the frames start being drawn at full size again.
     *
     * Going straight from the reduced size to full on the settled frame put a
     * blur-to-sharp snap at the exact moment the ring stopped, which reads as
     * the animation ending badly rather than arriving. Ramping back over the
     * last quarter hides it, and costs a larger bitmap on only two frames.
     */
    private static final float FOCUS_SHARPEN_FROM = 0.74f;

    /**
     * Which morph is current. Bumped by every tap, and checked by each frame
     * before it draws.
     *
     * Without it a second tap did not stop the first run: both sets of frames
     * kept arriving and the ring visibly fought itself, and because the
     * superseded run still drew its own settled frame the widget could come to
     * rest showing a category that was no longer the one on record — the next
     * redraw, minutes later, would jump to the right one for no visible reason.
     *
     * Only ever touched on the main thread, where broadcasts are delivered and
     * frames are posted.
     */
    private static int focusGeneration = 0;

    /**
     * Run the ring between two states, then leave it settled.
     *
     * `goAsync` is what makes this possible at all. A broadcast receiver's
     * process is killable the moment onReceive returns, so posted frames would
     * simply stop arriving and leave the donut stranded halfway. Holding the
     * result keeps the process up for the third of a second this takes, and
     * finishing it hands that back.
     *
     * The settled state is written to storage before any of it runs, so an
     * animation cut short by anything else still redraws correctly the next
     * time the widget is touched.
     */
    private static void animateFocus(Context context, int appWidgetId,
                                     String from, String to,
                                     BroadcastReceiver.PendingResult pending) {
        // Opening runs 0 -> 1 against the category being opened; closing runs
        // 1 -> 0 against the one being closed. Either way one name is on the
        // ring for the whole run, which is what makes it a single morph rather
        // than a cut between two pictures.
        final boolean opening = !to.isEmpty();
        final String subject = opening ? to : from;

        // Any frames still in flight belong to the previous tap.
        final int generation = ++focusGeneration;

        // Read once for the whole run. This is a file read, a JSON parse and a
        // merge of the pending captures, and doing it per frame was the most
        // expensive thing happening while the ring was moving.
        JSONObject snapshot = currentSnapshot(context);

        if (subject.isEmpty() || animationsDisabled(context)) {
            renderFrame(context, appWidgetId, snapshot, subject, opening ? 1f : 0f, 1f, true);
            if (pending != null) pending.finish();
            return;
        }

        new FocusRun(context, appWidgetId, subject, opening, snapshot, pending, generation)
            .start();
    }

    /**
     * One morph, drawing itself frame by frame off the clock rather than off a
     * queue of pre-scheduled frames.
     */
    private static final class FocusRun implements Runnable {
        private final Context context;
        private final int appWidgetId;
        private final String subject;
        private final boolean opening;
        private final JSONObject snapshot;
        private final BroadcastReceiver.PendingResult pending;
        private final int generation;
        private final android.os.Handler handler =
            new android.os.Handler(android.os.Looper.getMainLooper());
        private final android.view.animation.Interpolator easing =
            new android.view.animation.PathInterpolator(0.32f, 0.72f, 0.24f, 1f);
        private final long startedAt = android.os.SystemClock.uptimeMillis();
        private long nextFrameAt = startedAt;

        FocusRun(Context context, int appWidgetId, String subject, boolean opening,
                 JSONObject snapshot, BroadcastReceiver.PendingResult pending,
                 int generation) {
            this.context = context;
            this.appWidgetId = appWidgetId;
            this.subject = subject;
            this.opening = opening;
            this.snapshot = snapshot;
            this.pending = pending;
            this.generation = generation;
        }

        void start() {
            schedule();
        }

        @Override
        public void run() {
            // A newer tap owns the widget now. Its own settled frame is coming,
            // so stop here rather than drawing over it.
            if (generation != focusGeneration) {
                finish();
                return;
            }

            long elapsed = android.os.SystemClock.uptimeMillis() - startedAt;
            float linear = elapsed >= FOCUS_ANIM_MS
                ? 1f
                : Math.max(0f, elapsed / (float) FOCUS_ANIM_MS);
            boolean last = linear >= 1f;
            float eased = last ? 1f : easing.getInterpolation(linear);

            try {
                renderFrame(context, appWidgetId, snapshot, subject,
                    opening ? eased : 1f - eased,
                    last ? 1f : frameScale(eased), last);
            } catch (Exception e) {
                Log.w(TAG, "focus frame failed", e);
            }

            if (last) {
                finish();
                return;
            }
            schedule();
        }

        /**
         * The next frame, on the cadence the run started on — skipping any slot
         * that has already gone by while this frame was being drawn, so a slow
         * render costs a picture rather than pushing the whole morph late.
         */
        private void schedule() {
            long now = android.os.SystemClock.uptimeMillis();
            do {
                nextFrameAt += FOCUS_FRAME_MS;
            } while (nextFrameAt <= now);
            handler.postAtTime(this, nextFrameAt);
        }

        private void finish() {
            if (pending != null) {
                try {
                    pending.finish();
                } catch (Exception e) {
                    Log.w(TAG, "could not release the broadcast", e);
                }
            }
        }
    }

    /** How large a mid-morph frame is drawn, easing back to full at the end. */
    private static float frameScale(float eased) {
        if (eased <= FOCUS_SHARPEN_FROM) return FOCUS_ANIM_SCALE;
        float k = (eased - FOCUS_SHARPEN_FROM) / (1f - FOCUS_SHARPEN_FROM);
        return FOCUS_ANIM_SCALE + ((1f - FOCUS_ANIM_SCALE) * k);
    }

    /**
     * Whether the phone has animations turned off.
     *
     * The same switch that stops the rest of Android animating. Someone who has
     * asked for that should not get a widget that morphs — and skipping it also
     * skips eight bitmaps they did not want drawn.
     */
    private static boolean animationsDisabled(Context context) {
        try {
            float scale = android.provider.Settings.Global.getFloat(
                context.getContentResolver(),
                android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f);
            return scale == 0f;
        } catch (Exception e) {
            return false;
        }
    }

    /** One frame of the morph. `settled` is what earns the tap targets. */
    private static void renderFrame(Context context, int appWidgetId, JSONObject snapshot,
                                    String focus, float progress, float scale,
                                    boolean settled) {
        renderOne(context, AppWidgetManager.getInstance(context), appWidgetId,
            snapshot, focus, progress, scale, settled);
    }

    private static void renderOne(Context context, AppWidgetManager manager, int appWidgetId) {
        renderOne(context, manager, appWidgetId, null, null, -1f, 1f, true);
    }

    /**
     * What the widget is drawn from: the app's last snapshot with the captures
     * taken since merged in, or an empty month.
     */
    private static JSONObject currentSnapshot(Context context) {
        JSONObject snapshot = WidgetDeltaStore.readSnapshot(context);
        if (snapshot != null) {
            snapshot = staleMonthGuard(WidgetDeltaStore.mergeInto(context, snapshot));
        }
        if (snapshot == null) {
            // Never opened, or the stored JSON is unreadable. An empty month
            // renders as a ring plus "No spending yet", which is a better first
            // impression than a blank tile.
            snapshot = emptySnapshot();
        }
        return snapshot;
    }

    /**
     * `prepared` is the morph's copy, read once and handed to every frame. Null
     * everywhere else, which reads the current one.
     */
    private static void renderOne(Context context, AppWidgetManager manager, int appWidgetId,
                                  JSONObject prepared, String focusOverride, float progress,
                                  float scale, boolean settled) {
        try {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_covault);

            JSONObject snapshot = prepared != null ? prepared : currentSnapshot(context);

            // A category is only ever open on the widget it was opened on, and
            // only while the figures it was opened against still stand. A fresh
            // snapshot clears it: the list behind it has changed, and leaving
            // it open would show yesterday's purchases under today's ring.
            String focus = focusOverride != null ? focusOverride : readFocus(context, appWidgetId);
            // Cleared first, not just overwritten: the morph hands the same
            // object to every frame, and a "focus" left over from the previous
            // one would keep a category open on the frame that closes it.
            snapshot.remove("focus");
            snapshot.remove("focusProgress");
            if (!focus.isEmpty()) {
                try {
                    snapshot.put("focus", focus);
                    if (progress >= 0f) snapshot.put("focusProgress", progress);
                } catch (Exception e) {
                    Log.w(TAG, "could not apply focus", e);
                }
            }

            float[] spec = bitmapSpec(context, manager, appWidgetId);
            if (scale < 1f) {
                // Mid-morph frames are drawn smaller and scaled back up by the
                // ImageView. Nothing on one is readable while the ring is
                // moving, and it is the difference between this animation
                // costing 6MB of Binder traffic and costing 2.
                spec = new float[] {
                    Math.max(120f, spec[0] * scale),
                    Math.max(80f, spec[1] * scale),
                    spec[2] * scale,
                };
            }
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

            // Tap targets belong to a widget that has stopped moving. Placing
            // them on a mid-morph frame would put them where an arc was for a
            // fortieth of a second, which is a way to open the wrong category.
            if (settled) {
                // Category rows open Covault at that budget, expanded.
                placeLegendHits(context, views, spec);
                // The donut's bands open a category on the widget itself, and
                // the hole in the middle closes it again.
                placeDonutHits(context, views, spec, appWidgetId);
            } else {
                hideAllHits(views);
            }

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
                views.setContentDescription(R.id.widget_review_hit,
                    pending + (pending == 1 ? " transaction" : " transactions") + " to review");
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
            // Every target here is an invisible box over a picture, so without
            // this a screen reader announces an unlabelled button.
            views.setContentDescription(id, "Open " + hit.category);
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

        java.util.List<WidgetRenderer.HitRect> arcs = WidgetRenderer.lastArcHits();
        java.util.List<WidgetRenderer.HitRect> placed = new java.util.ArrayList<>();
        int slot = 0;
        for (WidgetRenderer.HitRect arc : arcs) {
            if (slot >= ARC_HIT_IDS.length) break;
            if (overlapsAny(arc, placed)) continue;
            place(views, ARC_HIT_IDS[slot], arc, pxPerDp);
            views.setOnClickPendingIntent(ARC_HIT_IDS[slot],
                focusIntent(context, appWidgetId, arc.category, slot + 1));
            views.setContentDescription(ARC_HIT_IDS[slot], "Show " + arc.category);
            placed.add(arc);
            slot++;
        }

        // The middle. Opened on a category it closes it; otherwise it is the
        // month's total and it opens the app — the figure you read is the
        // thing you reach for, and it was previously the one part of the
        // widget that looked like a button and did nothing.
        //
        // Placed last and only if it clears every arc target, because those
        // targets sit on top of it in the layout order and the ring is the
        // more precise gesture. On a cramped widget the total simply is not
        // tappable, which is the same trade the thin slices already take.
        WidgetRenderer.HitRect centre = WidgetRenderer.lastCentreHit();
        if (centre != null && !overlapsAny(centre, placed)) {
            place(views, R.id.widget_centre_hit, centre, pxPerDp);
            boolean isTotal = centre.category.isEmpty();
            views.setOnClickPendingIntent(R.id.widget_centre_hit,
                isTotal ? openIntent(context) : focusIntent(context, appWidgetId, "", 0));
            views.setContentDescription(R.id.widget_centre_hit,
                isTotal ? "Open Covault" : "Show every category");
        }
    }

    /** Every tap target off, for a frame that is still moving. */
    private static void hideAllHits(RemoteViews views) {
        for (int id : LEGEND_HIT_IDS) views.setViewVisibility(id, android.view.View.GONE);
        for (int id : ARC_HIT_IDS) views.setViewVisibility(id, android.view.View.GONE);
        views.setViewVisibility(R.id.widget_centre_hit, android.view.View.GONE);
        views.setViewVisibility(R.id.widget_review_hit, android.view.View.GONE);
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

    /**
     * Plain launch, no destination — the app opens where it normally does.
     *
     * Its own request code for the same reason review's is distinct: two
     * PendingIntents that differ only in their extras are one intent as far as
     * the system is concerned, so sharing a code with the review intent would
     * land this on Review instead.
     */
    private static PendingIntent openIntent(Context context) {
        Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (open == null) open = new Intent(context, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(context, 2, open,
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

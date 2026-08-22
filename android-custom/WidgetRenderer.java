package com.covault.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PorterDuff;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Draws the widget.
 *
 * Pure rendering: it takes a snapshot and produces a Bitmap, and knows nothing
 * about AppWidgetManager, SharedPreferences or broadcasts. That keeps the part
 * with all the geometry in it reasonable to follow on its own.
 *
 * This is a second implementation of a chart that also exists in React
 * (components/dashboard_components/BudgetFlowChart.tsx draws the in-app one with
 * d3). A widget is RemoteViews — no WebView, no JavaScript — so sharing the
 * drawing code is not possible. What *can* be kept in step is the palette, and
 * lib/__tests__/widgetPalette.test.ts parses CATEGORY_COLORS below and fails the
 * build if it drifts from lib/budgetColors.ts.
 */
final class WidgetRenderer {

    private WidgetRenderer() {}

    // ── Palette ───────────────────────────────────────────────────────────
    // Mirrors BUDGET_CATEGORY_COLORS in lib/budgetColors.ts. Do not edit one
    // without the other; widgetPalette.test.ts enforces it.
    // CATEGORY_COLORS_BEGIN
    static final String[][] CATEGORY_COLORS = {
        { "Housing",   "#5b9e97" },
        { "Groceries", "#6b9e6e" },
        { "Transport", "#6e8ec4" },
        { "Utilities", "#c49a4a" },
        { "Leisure",   "#9a7bbf" },
        { "Services",  "#5ea0ad" },
        { "Other",     "#8a95a3" },
    };
    // CATEGORY_COLORS_END

    /** Theme colours, matching the app's card surfaces and slate text ramp. */
    private static final class Palette {
        final int surface, primary, secondary, track, danger, balance;
        Palette(int surface, int primary, int secondary, int track, int danger, int balance) {
            this.surface = surface;
            this.primary = primary;
            this.secondary = secondary;
            this.track = track;
            this.danger = danger;
            // What the app paints the remaining balance. See DashboardBalanceSection.
            this.balance = balance;
        }
    }

    private static final Palette LIGHT = new Palette(
        Color.parseColor("#FFFFFF"),   // card surface
        Color.parseColor("#475569"),   // slate-600
        Color.parseColor("#94A3B8"),   // slate-400
        // slate-200, not slate-100. The track is the whole of an empty month,
        // and against a white card slate-100 is very nearly invisible.
        Color.parseColor("#E2E8F0"),
        Color.parseColor("#E11D48"),   // rose-600, for being over budget
        Color.parseColor("#10B981"));  // emerald-500 — the app's balance figure

    private static final Palette DARK = new Palette(
        Color.parseColor("#0F172A"),   // slate-900
        Color.parseColor("#F1F5F9"),
        Color.parseColor("#64748B"),   // slate-500
        Color.parseColor("#1E293B"),   // slate-800
        Color.parseColor("#FB7185"),   // rose-400
        Color.parseColor("#34D399"));  // emerald-400 — the app's balance figure

    /**
     * Smallest arc, in degrees, that can carry an icon chip without colliding
     * with its neighbours. Seven categories on a 4x2 widget will produce arcs
     * of a couple of degrees; those keep their colour and go unlabelled rather
     * than stacking icons on top of each other. Slices arrive largest-first, so
     * whatever loses its icon is the least significant spend.
     */
    private static final float MIN_ICON_ARC_DEGREES = 26f;

    /** Gap between arcs, in degrees, so slice boundaries read at a glance. */
    private static final float ARC_GAP_DEGREES = 2f;

    /**
     * What is left of a band too thin to carry a gap and two round caps: a
     * bead the width of the ring, which is the smallest mark that still reads
     * as belonging to a category.
     */
    private static final float ARC_BEAD_DEGREES = 0.1f;

    /**
     * The text's own clock, as fractions of a morph.
     *
     * Text does not travel with the ring, it swaps — the month's total for one
     * category's, "left to spend" for that category's name, the legend for its
     * purchases. So the outgoing text is gone by the first of these and the
     * incoming one starts arriving at the second, leaving the middle of the
     * morph with nothing legible on it: the ring has the widget to itself
     * exactly while it is moving fastest and being drawn smallest.
     *
     * Deliberately on the morph's linear clock rather than the ring's easing.
     * The easing is most of the way done a third of the way through, and a
     * fade tied to it would be over before the ring had visibly moved.
     */
    private static final float TEXT_FADE_OUT_BY = 0.22f;
    private static final float TEXT_FADE_IN_FROM = 0.66f;

    /**
     * @param dp pixels per dp in the bitmap being drawn into. Everything is
     *           sized from this rather than from the bitmap's own dimensions —
     *           see the note on `render` below.
     * @param renderScale how much smaller than the widget this bitmap is being
     *           drawn, 1 for a settled one. A handful of sizes below are floors
     *           and ceilings in raw pixels rather than in dp, and those are the
     *           only things here that do not shrink with the bitmap on their
     *           own. Left alone they made a mid-morph frame — which is scaled
     *           back up to fill the widget — come out with a ring a tenth
     *           thicker and a caption half again too big, so the ring visibly
     *           swelled and the text jumped size the moment an animation
     *           started and again when it stopped. That was the wobble.
     */
    static Bitmap render(Context context, JSONObject snapshot, int widthPx, int heightPx,
                         boolean systemDark, float dp, float renderScale) {
        Palette p = resolvePalette(snapshot, systemDark);

        // Cleared up front, not where each is filled. Several paths below
        // return early — a widget too small to draw a ring in, a narrow one
        // with no legend — and any of them would otherwise leave the previous
        // render's targets in place, floating over whatever is drawn this time.
        LAST_LEGEND_HITS.clear();
        LAST_ARC_HITS.clear();
        LAST_CENTRE_HIT = null;

        Bitmap bitmap = Bitmap.createBitmap(widthPx, heightPx, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);

        Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        fill.setStyle(Paint.Style.FILL);

        // Card surface, at the same corner weight as the app's cards. Drawn
        // into the bitmap so it looks right on launchers that don't clip
        // widgets themselves.
        float corner = Math.min(28f * dp, Math.min(widthPx, heightPx) * 0.22f);
        fill.setColor(p.surface);
        canvas.drawRoundRect(new RectF(0, 0, widthPx, heightPx), corner, corner, fill);

        float pad = 14f * dp;

        // ── Header: the SNAPSHOT's month, not today's ──
        // If the month rolled over while the app sat unopened, this says "July"
        // rather than quietly presenting July's numbers under August.
        Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
        text.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        text.setColor(p.secondary);
        float headerSize = 15f * dp;
        text.setTextSize(headerSize);
        String month = snapshot.optString("monthLabel", "");
        canvas.drawText(month, pad, pad + headerSize, text);

        // ── "N to review" pill ──
        // Covault's capture notification is otherwise the only signal that
        // something needs attention, and dismissing it by mistake loses that.
        // Amber matches the "Needs a look" treatment in the app. Hidden
        // entirely at zero — an always-present "0 to review" is noise.
        int pending = snapshot.optInt("pendingReview", 0);
        if (pending > 0) {
            drawReviewPill(canvas, pending, widthPx, pad, headerSize, dp, p);
        }

        // ── Composition ──
        // The widget's design size is 4x2 cells, i.e. more than twice as wide
        // as it is tall, while the donut can only ever be as big as the height
        // allows. Centring it left a third of the card empty on either side.
        // When there is room, the donut moves left and the space becomes the
        // legend the donut has never had — which also gives the small
        // categories a name, since an arc under MIN_ICON_ARC_DEGREES cannot
        // carry an icon.
        float availTop = pad + headerSize + (6f * dp);
        float availH = heightPx - availTop - pad;
        float availW = widthPx - (2 * pad);

        List<Slice> slices = readSlices(snapshot);
        double total = 0;
        for (Slice s : slices) total += s.amount;

        boolean wide = availW > availH * 1.5f && availW - availH > 96f * dp;
        float legendLeft = 0, legendWidth = 0;
        float diameter = availH;
        if (wide && total > 0) {
            legendWidth = Math.min(availW - availH - (12f * dp), 190f * dp);
            legendLeft = widthPx - pad - legendWidth;
        } else {
            diameter = Math.min(availW, availH);
        }

        float ringStroke = clamp(diameter * 0.17f, 8f * renderScale, 34f * renderScale);
        float chipRadius = Math.min(ringStroke * 0.62f, diameter * 0.085f);
        float outerInset = chipRadius; // chips overhang the ring by up to this

        float cx = legendWidth > 0
            ? pad + (diameter / 2f)
            : widthPx / 2f;
        float cy = availTop + (availH / 2f);
        float radius = (diameter / 2f) - outerInset;
        if (radius <= 0) return bitmap;

        RectF ring = new RectF(cx - radius, cy - radius, cx + radius, cy + radius);

        Paint arc = new Paint(Paint.ANTI_ALIAS_FLAG);
        arc.setStyle(Paint.Style.STROKE);
        arc.setStrokeWidth(ringStroke);
        arc.setStrokeCap(Paint.Cap.BUTT);

        // Track always drawn, so an empty month is a ring rather than a void.
        arc.setColor(p.track);
        canvas.drawArc(ring, 0, 360, false, arc);

        // ── Opened on one category ──
        // The whole ring becomes that category, so the donut answers "how much
        // of this month is this" without needing a legend to read the arc
        // against. Everything else on the widget follows: the centre figure
        // becomes the category's spend, and the right-hand column becomes its
        // purchases. Drawn before the ordinary arcs so there is exactly one
        // path through this and no chance of both appearing.
        // ── Opening and closing a category ──
        //
        // One path, not two, with `t` running 0 (the whole month) to 1 (one
        // category filling the ring). The provider renders a run of frames
        // across that range to animate it and passes 0 or 1 for a settled
        // widget, so what is drawn mid-flight is the same code that draws
        // either end — there is no separate animation to fall out of step.
        //
        // The slices keep their own places and their own colours; only their
        // shares move. Because every share is interpolated towards a set of
        // targets that also sums to 360, the total stays 360 at every value of
        // t, so laying them out end to end from 12 o'clock works throughout.
        // What that looks like is the chosen category eating the others, which
        // is what opening it means.
        Slice focused = findFocused(slices, focusName(snapshot));
        float t = focused == null
            ? 0f
            : clamp((float) snapshot.optDouble("focusProgress", 1.0), 0f, 1f);

        // How far through the swap the words are — see TEXT_FADE_OUT_BY.
        //
        // `focusFade` is the morph's linear clock, absent on a settled widget.
        // `focusOpening` says which end the run finishes on, which is the one
        // thing the ring's own position cannot tell us: a half-open category is
        // the same picture whether it is on its way in or out.
        float fadeClock = (float) snapshot.optDouble("focusFade", -1.0);
        boolean morphing = fadeClock >= 0f;
        boolean opening = snapshot.optBoolean("focusOpening", true);
        boolean endsFocused = morphing ? opening : focused != null;
        boolean startsFocused = morphing ? !opening : focused != null;
        float leaving = morphing
            ? 1f - clamp(fadeClock / TEXT_FADE_OUT_BY, 0f, 1f)
            : 0f;
        float arriving = morphing
            ? clamp((fadeClock - TEXT_FADE_IN_FROM) / (1f - TEXT_FADE_IN_FROM), 0f, 1f)
            : 1f;
        // Settled, one of these is 1 and the other 0, which is the same code
        // drawing a widget nobody is touching.
        float focusedText = (endsFocused ? arriving : 0f) + (startsFocused ? leaving : 0f);
        float monthText = (endsFocused ? 0f : arriving) + (startsFocused ? 0f : leaving);

        if (total > 0) {
            // Rounded ends on the coloured bands, because a square corner at
            // every boundary reads as four hard edges per slice and the app's
            // own bars are rounded.
            //
            // A round cap draws half a stroke width PAST each end of the arc,
            // so every band has to give that length back or neighbours grow
            // into the gap between them and meet. In degrees at this radius,
            // that is capDegrees.
            arc.setStrokeCap(Paint.Cap.ROUND);
            float capDegrees = (float) Math.toDegrees((ringStroke / 2f) / radius);

            float start = -90f; // 12 o'clock
            // No gaps once a single category owns the ring — a notch in a solid
            // ring has nothing to separate.
            boolean gapped = slices.size() > 1 && t < 1f;
            for (Slice s : slices) {
                float share = (float) (s.amount / total) * 360f;
                float target = focused == null ? share : (s == focused ? 360f : 0f);
                float sweep = share + ((target - share) * t);
                if (sweep > 0.05f) {
                    // Taken off both ends rather than one, so a band sits in
                    // the middle of its own share. Off one end it drifted by
                    // half a gap, which nothing showed up against a square
                    // edge and a round one does.
                    float inset = gapped ? (ARC_GAP_DEGREES / 2f) + capDegrees : 0f;
                    float drawSweep = sweep - (inset * 2f);
                    // A band too narrow to survive the trim becomes the bead
                    // its two caps make on their own — and that bead is drawn
                    // NARROWER than the ring so it still fits inside the share
                    // it stands for. At this stroke width a full-width bead is
                    // twenty-odd degrees across, which for a category worth
                    // three percent of the month would be a blob sitting on top
                    // of its neighbours claiming several times its size.
                    //
                    // What it looks like instead is the ring's small categories
                    // trailing off into dots that shrink with their share, and
                    // it is also how a band leaves during a morph: it thins as
                    // it narrows rather than turning into a sliver.
                    if (drawSweep < ARC_BEAD_DEGREES) {
                        float room = (float) Math.toRadians(
                            Math.max(0f, sweep - ARC_GAP_DEGREES)) * radius;
                        arc.setStrokeWidth(Math.max(1f, Math.min(ringStroke, room)));
                        drawSweep = ARC_BEAD_DEGREES;
                        inset = Math.max(0f, (sweep - ARC_BEAD_DEGREES) / 2f);
                    } else {
                        arc.setStrokeWidth(ringStroke);
                    }
                    arc.setColor(s.color);
                    canvas.drawArc(ring, start + inset, drawSweep, false, arc);
                }
                s.midAngle = start + (sweep / 2f);
                s.sweep = sweep;
                start += sweep;
            }
        }

        // ── Centre: the number you actually read ──
        Paint centre = new Paint(Paint.ANTI_ALIAS_FLAG);
        centre.setTextAlign(Paint.Align.CENTER);
        centre.setColor(p.primary);
        centre.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));

        // Opened on a category, the centre is that category's spend. Showing
        // the month's total inside a ring that is entirely one category would
        // be two different questions answered in the same place.
        //
        // The two figures cross-fade; they are not counted between. Counting
        // one into the other put a slot machine in the middle of the widget,
        // and because the figure is fitted to the hole it changed size as its
        // digits did — a five-character month shrinking into a four-character
        // category, one frame at a time.
        double monthSpent = snapshot.optDouble("totalSpent", 0);
        String monthValue = money(monthSpent);
        String focusedValue = focused != null ? money(focused.amount) : monthValue;

        // Shrink to fit the hole rather than drawing over the ring. The review
        // pill has always measured itself; this did not, so a five-figure month
        // printed straight across the arcs.
        //
        // Fitted once, to whichever figure is widest, and every frame of an
        // animation is drawn at that size — including a run that is genuinely
        // counting, which hands in the value it is counting towards. A figure
        // that re-fits itself per frame is a figure that changes size while you
        // are reading it.
        float hole = (radius - (ringStroke / 2f)) * 2f * 0.88f;
        String sizer = snapshot.optString("centreSizeLabel", "");
        if (sizer.isEmpty()) {
            sizer = centre.measureText(focusedValue) > centre.measureText(monthValue)
                ? focusedValue
                : monthValue;
        }
        float totalSize = clamp(radius * 0.42f, 13f * renderScale, 40f * renderScale);
        centre.setTextSize(totalSize);
        float measured = centre.measureText(sizer);
        if (measured > hole && measured > 0) {
            totalSize = Math.max(11f * renderScale, totalSize * (hole / measured));
            centre.setTextSize(totalSize);
            measured = centre.measureText(sizer);
        }

        float centreBaseline = cy + (totalSize * 0.34f);
        if (monthText > 0f) {
            centre.setAlpha(alpha255(monthText));
            canvas.drawText(monthValue, cx, centreBaseline, centre);
        }
        if (focused != null && focusedText > 0f) {
            centre.setAlpha(alpha255(focusedText));
            canvas.drawText(focusedValue, cx, centreBaseline, centre);
        }
        centre.setAlpha(255);

        Paint sub = new Paint(Paint.ANTI_ALIAS_FLAG);
        sub.setTextAlign(Paint.Align.CENTER);
        float subSize = clamp(totalSize * 0.36f, 9f * renderScale, 14f * renderScale);
        sub.setTextSize(subSize);
        float subY = centreBaseline + subSize + (4f * dp);

        // The line under it swaps on the same clock: what is left of the month,
        // or the name of the category that has taken the ring over.
        //
        // "Nothing here yet" is about there being nothing at all, not about the
        // ring being empty. Branching on the slices alone meant a month with
        // more refunds than purchases printed a negative total directly above
        // the words "No spending yet".
        if (monthText > 0f) {
            sub.setColor(p.secondary);
            sub.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
            sub.setAlpha(alpha255(monthText));
            if (total <= 0 && Math.abs(monthSpent) < 0.005) {
                canvas.drawText("No spending yet", cx, subY, sub);
            } else if (legendWidth <= 0) {
                // Only when there is no legend. On a wide widget the same
                // figure is the first thing in the right-hand column, at a size
                // that can actually be read — printing it here as well would be
                // the same number twice, one of them as a footnote.
                double remaining = snapshot.optDouble("remaining", 0);
                // Negative remaining is real information — render it, don't
                // clamp it. It also gets the app's rose and a bold weight:
                // being over budget was previously distinguishable only by a
                // minus sign.
                if (remaining < 0) {
                    sub.setColor(p.danger);
                    sub.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
                    canvas.drawText(money(-remaining) + " over", cx, subY, sub);
                } else {
                    canvas.drawText(money(remaining) + " left", cx, subY, sub);
                }
            }
        }
        if (focused != null && focusedText > 0f) {
            // The category's own name, because the ring no longer says which
            // one it is — every band is the same colour now.
            sub.setColor(focused.color);
            sub.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
            sub.setAlpha(alpha255(focusedText));
            canvas.drawText(focused.name, cx, subY, sub);
        }
        sub.setAlpha(255);
        // ── Icons on the arcs. These are the labels; there is no legend. ──
        // Icon chips are how the arcs are labelled. With one category filling
        // the ring there is nothing to tell apart, and a single chip adrift on
        // a solid ring reads as a stray dot.
        if (t < 1f && total > 0 && chipRadius >= 6f * renderScale) {
            int chipAlpha = alpha255(1f - t);
            for (Slice s : slices) {
                if (s.sweep < MIN_ICON_ARC_DEGREES) continue;
                double rad = Math.toRadians(s.midAngle);
                float ix = cx + (float) (Math.cos(rad) * radius);
                float iy = cy + (float) (Math.sin(rad) * radius);

                fill.setColor(s.color);
                fill.setAlpha(chipAlpha);
                canvas.drawCircle(ix, iy, chipRadius, fill);
                fill.setAlpha(255);

                Drawable icon = iconFor(context, s.name);
                if (icon != null) {
                    // mutate() first: it can return a different instance, so
                    // bounds or filters set before it would be applied to the
                    // one we then throw away. It also stops the colour filter
                    // leaking into the shared constant state, which would tint
                    // every other user of the same drawable resource.
                    icon = icon.mutate();
                    // Knocked out in the surface colour so the glyph reads
                    // against its own category colour in either theme.
                    icon.setColorFilter(p.surface, PorterDuff.Mode.SRC_IN);
                    icon.setAlpha(chipAlpha);
                    int glyph = (int) Math.max(6f * renderScale, chipRadius * 1.15f);
                    icon.setBounds(
                        (int) (ix - glyph / 2f), (int) (iy - glyph / 2f),
                        (int) (ix + glyph / 2f), (int) (iy + glyph / 2f));
                    icon.draw(canvas);
                }
            }
        }

        // Both columns are drawn while the ring is moving, one leaving and one
        // arriving. Neither is a different widget; the column is saying a
        // different thing about the same month.
        if (legendWidth > 0) {
            if (monthText > 0f) {
                drawLegend(canvas, snapshot, slices, legendLeft, legendWidth,
                    availTop, availH, dp, p, monthText);
            }
            if (focused != null && focusedText > 0f) {
                drawRecent(canvas, snapshot, focused, legendLeft, legendWidth,
                    availTop, availH, dp, p, focusedText);
            }
        }

        // Where each arc's chip sits, which is the one point on a slice a
        // rectangle can cover without straying onto its neighbours. The
        // launcher cannot hit-test a picture, so without these the ring is not
        // tappable at all. Recorded even for slices too thin to carry an icon —
        // the provider drops the ones whose targets would overlap.
        if (t <= 0f && total > 0) {
            for (Slice s : slices) {
                double rad = Math.toRadians(s.midAngle);
                float ix = cx + (float) (Math.cos(rad) * radius);
                float iy = cy + (float) (Math.sin(rad) * radius);
                float half = Math.max(ringStroke, 22f * dp) * 0.75f;
                LAST_ARC_HITS.add(new HitRect(s.name, ix - half, iy - half, ix + half, iy + half));
            }
        }

        // The middle of the ring, which does one of two things depending on
        // what is drawn there.
        //
        // Opened on a category it is the way back out: a widget is never told
        // about taps that land outside it, so tapping away cannot close this —
        // this is the gesture that does. It takes the whole hole, because
        // nothing else in there competes for the tap.
        //
        // Otherwise it is the month's total, and tapping the figure you read
        // opens the app. That target is deliberately small: it is sized to the
        // number itself rather than the hole, so it cannot reach out over an
        // arc's icon chip and swallow a tap meant for a category. The provider
        // drops it anyway if it would overlap one.
        //
        // The empty category name is what tells the two apart.
        if (focused != null && t >= 1f) {
            LAST_CENTRE_HIT = new HitRect(focused.name,
                cx - (radius * 0.6f), cy - (radius * 0.6f),
                cx + (radius * 0.6f), cy + (radius * 0.6f));
        } else if (focused == null || t <= 0f) {
            float holeRadius = radius - (ringStroke / 2f);
            float halfW = Math.min(Math.max(measured * 0.62f, 26f * dp), holeRadius * 0.9f);
            float halfH = Math.min(Math.max(totalSize * 0.95f, 22f * dp), holeRadius * 0.55f);
            LAST_CENTRE_HIT = new HitRect("",
                cx - halfW, cy - halfH, cx + halfW, cy + halfH);
        } else {
            LAST_CENTRE_HIT = null;
        }

        return bitmap;
    }

    /**
     * Where each legend row was drawn, so the provider can lay an invisible tap
     * target over it.
     *
     * The widget is one bitmap and the launcher cannot hit-test a picture, so a
     * row is only tappable if something tells the provider where it ended up.
     * Filled by the last render; read immediately after. Values are in bitmap
     * pixels — the caller scales them to the widget's own bounds, which differ
     * because the bitmap is deliberately drawn smaller (see the provider's
     * MAX_BITMAP_PIXELS).
     */
    static final class HitRect {
        final String category;
        final float left, top, right, bottom;

        HitRect(String category, float left, float top, float right, float bottom) {
            this.category = category;
            this.left = left;
            this.top = top;
            this.right = right;
            this.bottom = bottom;
        }
    }

    /**
     * Legend row hit rectangles from the most recent render, in draw order.
     *
     * Static, and therefore shared by every placed widget. That is safe only
     * because rendering and reading both happen on the main thread inside one
     * renderOne() call — the provider draws, reads, and is done before the next
     * widget starts. Anything that made rendering concurrent would have to
     * return these instead.
     */
    private static final List<HitRect> LAST_LEGEND_HITS = new ArrayList<>();

    static List<HitRect> lastLegendHits() {
        return new ArrayList<>(LAST_LEGEND_HITS);
    }

    /** Arc tap targets from the most recent render, largest slice first. */
    private static final List<HitRect> LAST_ARC_HITS = new ArrayList<>();
    private static HitRect LAST_CENTRE_HIT = null;

    static List<HitRect> lastArcHits() {
        return new ArrayList<>(LAST_ARC_HITS);
    }

    /**
     * The target in the middle of the ring from the most recent render, or
     * null mid-morph. An empty category name means it is the month's total
     * ("open the app"); a name means it is an opened category ("close it").
     */
    static HitRect lastCentreHit() {
        return LAST_CENTRE_HIT;
    }

    /** The category the widget is currently opened on, or "" for none. */
    private static String focusName(JSONObject snapshot) {
        return snapshot.optString("focus", "");
    }

    /**
     * The slice being shown on its own, or null.
     *
     * Matched by name against what is actually in the snapshot, so a category
     * that has since gone to zero — or been renamed — quietly falls back to the
     * whole month rather than drawing an empty ring nobody can get out of.
     */
    private static Slice findFocused(List<Slice> slices, String name) {
        if (name == null || name.isEmpty()) return null;
        for (Slice s : slices) {
            if (name.equalsIgnoreCase(s.name)) return s;
        }
        return null;
    }

    /**
     * The category's own purchases, in place of the month's categories.
     *
     * Same column, same row rhythm and the same tap targets as the legend, so
     * opening a category rearranges what the widget says rather than turning it
     * into a different widget.
     */
    private static void drawRecent(Canvas canvas, JSONObject snapshot, Slice focused,
                                   float left, float width, float top, float height,
                                   float dp, Palette p, float alpha) {
        Paint heading = new Paint(Paint.ANTI_ALIAS_FLAG);
        heading.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        heading.setColor(p.secondary);
        heading.setAlpha(alpha255(alpha));
        heading.setTextSize(11.5f * dp);
        canvas.drawText("Recent", left, top + (11.5f * dp), heading);
        float headH = (11.5f * dp) + (10f * dp);

        JSONObject all = snapshot.optJSONObject("recent");
        JSONArray rows = all == null ? null : all.optJSONArray(focused.name);
        if (rows == null || rows.length() == 0) {
            Paint empty = new Paint(Paint.ANTI_ALIAS_FLAG);
            empty.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL));
            empty.setColor(p.secondary);
            empty.setAlpha(alpha255(alpha));
            empty.setTextSize(12.5f * dp);
            canvas.drawText("Nothing yet", left, top + headH + (12.5f * dp), empty);
            return;
        }

        Paint vendor = new Paint(Paint.ANTI_ALIAS_FLAG);
        vendor.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        vendor.setColor(p.primary);
        vendor.setAlpha(alpha255(alpha));
        vendor.setTextSize(13.5f * dp);

        Paint value = new Paint(Paint.ANTI_ALIAS_FLAG);
        value.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        value.setColor(p.secondary);
        value.setAlpha(alpha255(alpha));
        value.setTextSize(13.5f * dp);
        value.setTextAlign(Paint.Align.RIGHT);

        Paint when = new Paint(Paint.ANTI_ALIAS_FLAG);
        when.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL));
        when.setColor(p.secondary);
        when.setAlpha(alpha255(alpha));
        when.setTextSize(10f * dp);

        float rowH = 24f * dp;
        int max = (int) Math.floor((height - headH) / rowH);
        int count = Math.min(rows.length(), Math.max(0, max));
        float y = top + headH;

        for (int i = 0; i < count; i++) {
            JSONObject row = rows.optJSONObject(i);
            if (row == null) continue;
            String name = row.optString("vendor", "Unknown");
            String amount = money(row.optDouble("amount", 0));
            String day = row.optString("day", "");

            float baseline = y + (rowH / 2f) + (4f * dp);
            float amountW = value.measureText(amount);
            float dayW = day.isEmpty() ? 0 : when.measureText(day) + (5f * dp);
            float room = width - amountW - dayW - (8f * dp);

            canvas.drawText(ellipsise(name, vendor, room), left, baseline, vendor);
            if (!day.isEmpty()) {
                canvas.drawText(day, left + room + (4f * dp), baseline, when);
            }
            canvas.drawText(amount, left + width, baseline, value);
            y += rowH;
        }
    }

    /**
     * The biggest categories, named, down the right-hand side.
     *
     * Only drawn when the widget is wide enough that the donut cannot use the
     * space anyway. Rows are capped by what actually fits rather than by a
     * fixed count, so a short widget shows two and a tall one shows four —
     * nothing is ever half-drawn at the bottom edge.
     */
    private static void drawLegend(Canvas canvas, JSONObject snapshot, List<Slice> slices,
                                   float left, float width,
                                   float top, float height, float dp, Palette p,
                                   float alpha) {
        // ── What's left, above the categories ──
        //
        // The figure that answers "can I spend this" reads first, at the top of
        // the column, in the same weight and colour the app gives its own
        // total. It used to live under the donut's centre figure at a third of
        // the size, where it was a footnote to the number nobody needs as
        // often. Over budget keeps the app's rose, because a minus sign at this
        // size is easy to miss.
        float headH = 0;
        double remaining = snapshot.optDouble("remaining", 0);
        boolean haveRemaining = snapshot.has("remaining");
        if (haveRemaining) {
            Paint remainingPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            remainingPaint.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
            // The same green the app gives this figure, and the same rose when
            // it has gone negative. It was the ordinary text colour, which made
            // the one number on the widget you look for read as a label.
            remainingPaint.setColor(remaining < 0 ? p.danger : p.balance);
            remainingPaint.setAlpha(alpha255(alpha));
            float size = 30f * dp;
            remainingPaint.setTextSize(size);

            String value = remaining < 0 ? money(-remaining) : money(remaining);
            // Shrink rather than run under the donut. A five-figure month at a
            // narrow widget width would otherwise print straight off the left
            // edge of its own column.
            float measured = remainingPaint.measureText(value);
            if (measured > width && measured > 0) {
                size = Math.max(12f * dp, size * (width / measured));
                remainingPaint.setTextSize(size);
            }

            Paint caption = new Paint(Paint.ANTI_ALIAS_FLAG);
            caption.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
            caption.setColor(p.secondary);
            caption.setAlpha(alpha255(alpha));
            caption.setTextSize(11.5f * dp);

            canvas.drawText(value, left, top + size, remainingPaint);
            canvas.drawText(remaining < 0 ? "over budget" : "left to spend",
                left, top + size + (13f * dp), caption);
            headH = size + (13f * dp) + (12f * dp);
        }

        float rowH = 27f * dp;
        float legendTop = top + headH;
        float legendHeight = height - headH;
        int fits = Math.min((int) Math.floor(legendHeight / rowH), 4);
        if (fits < 1 || slices.isEmpty()) return;
        // More categories than there are rows to put them in: the last row
        // becomes the ones that did not fit, added up, and opens the app rather
        // than a budget. They were otherwise reachable only by hitting their
        // own band on the ring, which is not offered at all for a band too thin
        // to carry a tap target — so the tail of the month had nowhere to be
        // read from the home screen.
        //
        // Not when there is room for a single row: a lone "+5 more" says less
        // than the largest category does.
        boolean overflow = slices.size() > fits && fits >= 2;
        int shown = overflow ? fits - 1 : Math.min(fits, slices.size());
        int rows = shown + (overflow ? 1 : 0);
        // Centre what remains against the donut rather than hanging it off the
        // top — with the figure above, the block now sits under it.
        float y = legendTop + (legendHeight - (rows * rowH)) / 2f;

        float dot = 5.5f * dp;
        Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        fill.setStyle(Paint.Style.FILL);

        Paint name = new Paint(Paint.ANTI_ALIAS_FLAG);
        name.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        name.setColor(p.primary);
        name.setAlpha(alpha255(alpha));
        name.setTextSize(14.5f * dp);

        Paint amount = new Paint(Paint.ANTI_ALIAS_FLAG);
        amount.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        amount.setColor(p.secondary);
        amount.setAlpha(alpha255(alpha));
        amount.setTextSize(14.5f * dp);
        amount.setTextAlign(Paint.Align.RIGHT);

        for (int i = 0; i < shown; i++) {
            Slice s = slices.get(i);
            float baseline = y + (rowH / 2f) + (4f * dp);

            fill.setColor(s.color);
            fill.setAlpha(alpha255(alpha));
            canvas.drawCircle(left + dot, y + (rowH / 2f), dot, fill);

            String value = money(s.amount);
            float valueW = amount.measureText(value);
            float nameLeft = left + (dot * 2f) + (7f * dp);
            float nameRoom = width - (nameLeft - left) - valueW - (6f * dp);

            canvas.drawText(ellipsise(s.name, name, nameRoom), nameLeft, baseline, name);
            canvas.drawText(value, left + width, baseline, amount);

            // Where the provider should put this row's tap target. Recorded
            // from the geometry that actually drew it rather than recomputed,
            // so the target cannot drift from the row it belongs to.
            if (alpha >= 1f) {
                LAST_LEGEND_HITS.add(new HitRect(s.name, left, y, left + width, y + rowH));
            }

            y += rowH;
        }

        if (overflow) {
            double rest = 0;
            for (int i = shown; i < slices.size(); i++) rest += slices.get(i).amount;
            float baseline = y + (rowH / 2f) + (4f * dp);

            // A hollow dot rather than a filled one: this row is not a category
            // and must not look like it has a colour of its own.
            Paint hollow = new Paint(Paint.ANTI_ALIAS_FLAG);
            hollow.setStyle(Paint.Style.STROKE);
            hollow.setStrokeWidth(Math.max(1f, 1.4f * dp));
            hollow.setColor(p.secondary);
            hollow.setAlpha(alpha255(alpha * 0.7f));
            canvas.drawCircle(left + dot, y + (rowH / 2f), dot - (0.7f * dp), hollow);

            name.setColor(p.secondary);
            String label = "+" + (slices.size() - shown) + " more";
            String value = money(rest);
            float valueW = amount.measureText(value);
            float nameLeft = left + (dot * 2f) + (7f * dp);
            float nameRoom = width - (nameLeft - left) - valueW - (6f * dp);

            canvas.drawText(ellipsise(label, name, nameRoom), nameLeft, baseline, name);
            canvas.drawText(value, left + width, baseline, amount);

            // The empty category name is the provider's cue to open the app
            // rather than one budget — the same cue the month's total uses.
            if (alpha >= 1f) {
                LAST_LEGEND_HITS.add(new HitRect("", left, y, left + width, y + rowH));
            }
        }
    }

    /** Trim to fit, with an ellipsis, rather than running under the amount. */
    private static String ellipsise(String value, Paint paint, float room) {
        if (value == null || value.isEmpty() || room <= 0) return "";
        if (paint.measureText(value) <= room) return value;
        for (int end = value.length() - 1; end > 0; end--) {
            String candidate = value.substring(0, end) + "…";
            if (paint.measureText(candidate) <= room) return candidate;
        }
        return "";
    }

    /** Amber used for "needs a look" in the app (amber-500 / amber-100). */
    private static final int PILL_BG = Color.parseColor("#FEF3C7");
    private static final int PILL_BG_DARK = Color.parseColor("#78350F");
    private static final int PILL_FG = Color.parseColor("#92400E");
    private static final int PILL_FG_DARK = Color.parseColor("#FDE68A");

    private static void drawReviewPill(
        Canvas canvas, int pending, int widthPx, float pad,
        float headerSize, float dp, Palette p
    ) {
        boolean dark = p == DARK;
        Paint pill = new Paint(Paint.ANTI_ALIAS_FLAG);
        pill.setStyle(Paint.Style.FILL);
        pill.setColor(dark ? PILL_BG_DARK : PILL_BG);

        Paint label = new Paint(Paint.ANTI_ALIAS_FLAG);
        label.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        label.setColor(dark ? PILL_FG_DARK : PILL_FG);
        label.setTextSize(13.5f * dp);

        // Prefer words; fall back to the bare number when the widget is too
        // narrow, which is better than clipping "3 to revi…".
        String full = pending + " to review";
        String text = full;
        float textW = label.measureText(text);
        float maxW = (widthPx / 2f) - pad;
        if (textW + (16f * dp) > maxW) {
            text = String.valueOf(pending);
            textW = label.measureText(text);
        }

        float padX = 8f * dp;
        float padY = 4.5f * dp;
        float h = label.getTextSize() + (padY * 2);
        float right = widthPx - pad;
        float left = right - textW - (padX * 2);
        float top = pad + (headerSize / 2f) - (h / 2f);

        RectF box = new RectF(left, top, right, top + h);
        canvas.drawRoundRect(box, h / 2f, h / 2f, pill);
        canvas.drawText(text, left + padX, top + padY + label.getTextSize() * 0.82f, label);
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    /**
     * The app's own theme setting wins over the system's. A user who has forced
     * dark in-app should not get a light widget sitting beside a dark app.
     */
    private static Palette resolvePalette(JSONObject snapshot, boolean systemDark) {
        String theme = snapshot.optString("theme", "");
        if ("dark".equals(theme)) return DARK;
        if ("light".equals(theme)) return LIGHT;
        return systemDark ? DARK : LIGHT;
    }

    private static final class Slice {
        String name;
        double amount;
        int color;
        float midAngle;
        float sweep;
    }

    private static List<Slice> readSlices(JSONObject snapshot) {
        List<Slice> out = new ArrayList<>();
        JSONArray arr = snapshot.optJSONArray("slices");
        if (arr == null) return out;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            double amount = o.optDouble("amount", 0);
            if (amount <= 0) continue;
            Slice s = new Slice();
            s.name = o.optString("name", "Other");
            s.amount = amount;
            s.color = parseColorOr(o.optString("color", ""), colorForCategory(s.name));
            out.add(s);
        }
        return out;
    }

    private static int parseColorOr(String hex, int fallback) {
        try {
            return Color.parseColor(hex);
        } catch (Exception e) {
            return fallback;
        }
    }

    static int colorForCategory(String name) {
        for (String[] row : CATEGORY_COLORS) {
            if (row[0].equalsIgnoreCase(name)) return Color.parseColor(row[1]);
        }
        return Color.parseColor("#8a95a3");
    }

    /**
     * Resolved by name so a missing drawable degrades to a plain colour chip
     * rather than throwing inside a widget update, which the launcher would
     * surface as "Problem loading widget".
     */
    private static Drawable iconFor(Context context, String category) {
        String lower = category == null ? "" : category.toLowerCase(Locale.US);
        String res;
        if (lower.contains("housing")) res = "ic_budget_housing";
        else if (lower.contains("groceries")) res = "ic_budget_groceries";
        else if (lower.contains("transport")) res = "ic_budget_transport";
        else if (lower.contains("utilities")) res = "ic_budget_utilities";
        else if (lower.contains("leisure") || lower.contains("dining")) res = "ic_budget_leisure";
        else if (lower.contains("services")) res = "ic_budget_services";
        else res = "ic_budget_other";
        try {
            int id = context.getResources().getIdentifier(res, "drawable", context.getPackageName());
            if (id == 0) return null;
            return androidx.core.content.ContextCompat.getDrawable(context, id);
        } catch (Exception e) {
            return null;
        }
    }

    /** Matches lib/formatCurrency.ts, minus the cents when the number is large. */
    /** Package-private: the provider formats the same figures for TalkBack. */
    static String money(double n) {
        String sign = n < 0 ? "-" : "";
        double abs = Math.abs(n);
        if (abs >= 1000) {
            return String.format(Locale.US, "%s$%,.0f", sign, abs);
        }
        return String.format(Locale.US, "%s$%.2f", sign, abs);
    }

    private static float clamp(float v, float min, float max) {
        return Math.max(min, Math.min(max, v));
    }

    /** A 0–1 fade as a Paint alpha, which is what Canvas actually takes. */
    private static int alpha255(float fraction) {
        return (int) clamp(fraction * 255f, 0f, 255f);
    }
}

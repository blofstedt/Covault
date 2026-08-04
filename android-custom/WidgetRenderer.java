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
        final int surface, primary, secondary, track, danger;
        Palette(int surface, int primary, int secondary, int track, int danger) {
            this.surface = surface;
            this.primary = primary;
            this.secondary = secondary;
            this.track = track;
            this.danger = danger;
        }
    }

    private static final Palette LIGHT = new Palette(
        Color.parseColor("#FFFFFF"),   // card surface
        Color.parseColor("#475569"),   // slate-600
        Color.parseColor("#94A3B8"),   // slate-400
        // slate-200, not slate-100. The track is the whole of an empty month,
        // and against a white card slate-100 is very nearly invisible.
        Color.parseColor("#E2E8F0"),
        Color.parseColor("#E11D48"));  // rose-600, for being over budget

    private static final Palette DARK = new Palette(
        Color.parseColor("#0F172A"),   // slate-900
        Color.parseColor("#F1F5F9"),
        Color.parseColor("#64748B"),   // slate-500
        Color.parseColor("#1E293B"),   // slate-800
        Color.parseColor("#FB7185"));  // rose-400

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
     * @param dp pixels per dp in the bitmap being drawn into. Everything is
     *           sized from this rather than from the bitmap's own dimensions —
     *           see the note on `render` below.
     */
    static Bitmap render(Context context, JSONObject snapshot, int widthPx, int heightPx,
                         boolean systemDark, float dp) {
        Palette p = resolvePalette(snapshot, systemDark);

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
        float headerSize = 13f * dp;
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
            legendWidth = Math.min(availW - availH - (12f * dp), 150f * dp);
            legendLeft = widthPx - pad - legendWidth;
        } else {
            diameter = Math.min(availW, availH);
        }

        float ringStroke = clamp(diameter * 0.17f, 8f, 34f);
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

        if (total > 0) {
            float start = -90f; // 12 o'clock
            boolean gapped = slices.size() > 1;
            for (Slice s : slices) {
                float sweep = (float) (s.amount / total) * 360f;
                // Only take the gap out of a slice wide enough to spare it.
                // Subtracting a fixed 2 degrees from a 1-degree sliver used to
                // draw it *wider* than its share, bleeding over its neighbour —
                // and a single-category month came out as a full ring with an
                // unexplained notch at 12 o'clock.
                float drawSweep = gapped && sweep > ARC_GAP_DEGREES * 2f
                    ? sweep - ARC_GAP_DEGREES
                    : sweep;
                arc.setColor(s.color);
                canvas.drawArc(ring, start, drawSweep, false, arc);
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
        double totalSpent = snapshot.optDouble("totalSpent", 0);
        String spentLabel = money(totalSpent);
        // Shrink to fit the hole rather than drawing over the ring. The review
        // pill has always measured itself; this did not, so a five-figure month
        // printed straight across the arcs.
        float hole = (radius - (ringStroke / 2f)) * 2f * 0.88f;
        float totalSize = clamp(radius * 0.42f, 13f, 40f);
        centre.setTextSize(totalSize);
        float measured = centre.measureText(spentLabel);
        if (measured > hole && measured > 0) {
            totalSize = Math.max(11f, totalSize * (hole / measured));
            centre.setTextSize(totalSize);
        }
        canvas.drawText(spentLabel, cx, cy + (totalSize * 0.34f), centre);

        Paint sub = new Paint(Paint.ANTI_ALIAS_FLAG);
        sub.setTextAlign(Paint.Align.CENTER);
        sub.setColor(p.secondary);
        sub.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        float subSize = clamp(totalSize * 0.36f, 9f, 14f);
        sub.setTextSize(subSize);
        float subY = cy + (totalSize * 0.34f) + subSize + (4f * dp);

        // "Nothing here yet" is about there being nothing at all, not about the
        // ring being empty. Branching on the slices alone meant a month with
        // more refunds than purchases printed a negative total directly above
        // the words "No spending yet".
        if (total <= 0 && Math.abs(totalSpent) < 0.005) {
            canvas.drawText("No spending yet", cx, subY, sub);
        } else {
            double remaining = snapshot.optDouble("remaining", 0);
            // Negative remaining is real information — render it, don't clamp
            // it. It also gets the app's rose and a bold weight: being over
            // budget was previously distinguishable only by a minus sign.
            if (remaining < 0) {
                sub.setColor(p.danger);
                sub.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
                canvas.drawText(money(-remaining) + " over", cx, subY, sub);
            } else {
                canvas.drawText(money(remaining) + " left", cx, subY, sub);
            }
        }

        // ── Icons on the arcs. These are the labels; there is no legend. ──
        if (total > 0 && chipRadius >= 6f) {
            for (Slice s : slices) {
                if (s.sweep < MIN_ICON_ARC_DEGREES) continue;
                double rad = Math.toRadians(s.midAngle);
                float ix = cx + (float) (Math.cos(rad) * radius);
                float iy = cy + (float) (Math.sin(rad) * radius);

                fill.setColor(s.color);
                canvas.drawCircle(ix, iy, chipRadius, fill);

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
                    int glyph = (int) Math.max(6f, chipRadius * 1.15f);
                    icon.setBounds(
                        (int) (ix - glyph / 2f), (int) (iy - glyph / 2f),
                        (int) (ix + glyph / 2f), (int) (iy + glyph / 2f));
                    icon.draw(canvas);
                }
            }
        }

        if (legendWidth > 0) {
            drawLegend(canvas, slices, legendLeft, legendWidth, availTop, availH, dp, p);
        }

        return bitmap;
    }

    /**
     * The biggest categories, named, down the right-hand side.
     *
     * Only drawn when the widget is wide enough that the donut cannot use the
     * space anyway. Rows are capped by what actually fits rather than by a
     * fixed count, so a short widget shows two and a tall one shows four —
     * nothing is ever half-drawn at the bottom edge.
     */
    private static void drawLegend(Canvas canvas, List<Slice> slices, float left, float width,
                                   float top, float height, float dp, Palette p) {
        float rowH = 22f * dp;
        int rows = (int) Math.floor(height / rowH);
        if (rows < 1) return;
        rows = Math.min(rows, Math.min(4, slices.size()));
        // Centre the block against the donut rather than hanging it off the top.
        float y = top + (height - (rows * rowH)) / 2f;

        float dot = 4.5f * dp;
        Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        fill.setStyle(Paint.Style.FILL);

        Paint name = new Paint(Paint.ANTI_ALIAS_FLAG);
        name.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        name.setColor(p.primary);
        name.setTextSize(12f * dp);

        Paint amount = new Paint(Paint.ANTI_ALIAS_FLAG);
        amount.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        amount.setColor(p.secondary);
        amount.setTextSize(12f * dp);
        amount.setTextAlign(Paint.Align.RIGHT);

        for (int i = 0; i < rows; i++) {
            Slice s = slices.get(i);
            float baseline = y + (rowH / 2f) + (4f * dp);

            fill.setColor(s.color);
            canvas.drawCircle(left + dot, y + (rowH / 2f), dot, fill);

            String value = money(s.amount);
            float valueW = amount.measureText(value);
            float nameLeft = left + (dot * 2f) + (7f * dp);
            float nameRoom = width - (nameLeft - left) - valueW - (6f * dp);

            canvas.drawText(ellipsise(s.name, name, nameRoom), nameLeft, baseline, name);
            canvas.drawText(value, left + width, baseline, amount);
            y += rowH;
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
        label.setTextSize(12f * dp);

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
}

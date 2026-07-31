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
        final int surface, primary, secondary, track;
        Palette(int surface, int primary, int secondary, int track) {
            this.surface = surface;
            this.primary = primary;
            this.secondary = secondary;
            this.track = track;
        }
    }

    private static final Palette LIGHT = new Palette(
        Color.parseColor("#FFFFFF"),   // card surface
        Color.parseColor("#475569"),   // slate-600
        Color.parseColor("#94A3B8"),   // slate-400
        Color.parseColor("#F1F5F9"));  // slate-100

    private static final Palette DARK = new Palette(
        Color.parseColor("#0F172A"),   // slate-900
        Color.parseColor("#F1F5F9"),
        Color.parseColor("#64748B"),   // slate-500
        Color.parseColor("#1E293B"));  // slate-800

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

    static Bitmap render(Context context, JSONObject snapshot, int widthPx, int heightPx, boolean systemDark) {
        Palette p = resolvePalette(snapshot, systemDark);

        Bitmap bitmap = Bitmap.createBitmap(widthPx, heightPx, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);

        Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        fill.setStyle(Paint.Style.FILL);

        // Card surface, at the same corner weight as the app's cards
        // (rounded-[2rem] = 32dp). Drawn into the bitmap so it looks right on
        // launchers that don't clip widgets themselves.
        float scale = Math.min(widthPx, heightPx) / 160f;
        float corner = Math.min(32f * scale, Math.min(widthPx, heightPx) * 0.22f);
        fill.setColor(p.surface);
        canvas.drawRoundRect(new RectF(0, 0, widthPx, heightPx), corner, corner, fill);

        float pad = Math.max(10f, 12f * scale);

        // ── Header: the SNAPSHOT's month, not today's ──
        // If the month rolled over while the app sat unopened, this says "July"
        // rather than quietly presenting July's numbers under August.
        Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
        text.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        text.setColor(p.secondary);
        float headerSize = clamp(11f * scale, 10f, 15f);
        text.setTextSize(headerSize);
        String month = snapshot.optString("monthLabel", "");
        canvas.drawText(month, pad, pad + headerSize, text);

        // ── Donut geometry ──
        float headerBottom = pad + headerSize + (4f * scale);
        float availTop = headerBottom;
        float availH = heightPx - availTop - pad;
        float availW = widthPx - (2 * pad);
        // Leave room for icon chips, which straddle the ring's centre-line.
        float diameter = Math.min(availW, availH);
        float ringStroke = clamp(diameter * 0.17f, 8f, 34f);
        float chipRadius = Math.min(ringStroke * 0.62f, diameter * 0.085f);
        float outerInset = chipRadius; // chips overhang the ring by up to this

        float cx = widthPx / 2f;
        float cy = availTop + (availH / 2f);
        float radius = (diameter / 2f) - outerInset;
        if (radius <= 0) return bitmap;

        RectF ring = new RectF(cx - radius, cy - radius, cx + radius, cy + radius);

        Paint arc = new Paint(Paint.ANTI_ALIAS_FLAG);
        arc.setStyle(Paint.Style.STROKE);
        arc.setStrokeWidth(ringStroke);
        arc.setStrokeCap(Paint.Cap.BUTT);

        List<Slice> slices = readSlices(snapshot);
        double total = 0;
        for (Slice s : slices) total += s.amount;

        // Track always drawn, so an empty month is a ring rather than a void.
        arc.setColor(p.track);
        canvas.drawArc(ring, 0, 360, false, arc);

        if (total > 0) {
            float start = -90f; // 12 o'clock
            for (Slice s : slices) {
                float sweep = (float) (s.amount / total) * 360f;
                float drawSweep = Math.max(sweep - ARC_GAP_DEGREES, 0.6f);
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
        float totalSize = clamp(radius * 0.42f, 13f, 40f);
        centre.setTextSize(totalSize);
        String spentLabel = money(snapshot.optDouble("totalSpent", 0));
        canvas.drawText(spentLabel, cx, cy + (totalSize * 0.34f), centre);

        Paint sub = new Paint(Paint.ANTI_ALIAS_FLAG);
        sub.setTextAlign(Paint.Align.CENTER);
        sub.setColor(p.secondary);
        sub.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        float subSize = clamp(totalSize * 0.36f, 9f, 14f);
        sub.setTextSize(subSize);

        if (total <= 0) {
            canvas.drawText("No spending yet", cx, cy + (totalSize * 0.34f) + subSize + (4f * scale), sub);
        } else {
            double remaining = snapshot.optDouble("remaining", 0);
            // Negative remaining is real information — render it, don't clamp it.
            String remainingLabel = money(remaining) + " left";
            canvas.drawText(remainingLabel, cx, cy + (totalSize * 0.34f) + subSize + (4f * scale), sub);
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

        return bitmap;
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
    private static String money(double n) {
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

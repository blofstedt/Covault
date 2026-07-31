package com.covault.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;
import java.util.Locale;

/**
 * Keeps the widget current between app launches.
 *
 * The widget has no Supabase session, so the app writes it an authoritative
 * snapshot whenever it loads data. On its own that means the widget only
 * refreshes when the app is opened. This class closes most of that gap: the
 * notification listener already runs natively with the app closed and already
 * knows the amount of a captured purchase, so it appends an optimistic delta
 * here and the widget redraws immediately.
 *
 * Two things make that safe:
 *
 *   1. The snapshot always wins. Only deltas captured *after* the snapshot's
 *      timestamp, and *within* the month the snapshot describes, are applied
 *      (see mergeInto). When the app next writes a snapshot it prunes
 *      everything older. So an optimistic guess the JS pipeline later rejects
 *      as not-a-transaction, dedups away, or files under a different category
 *      simply disappears on the next app open. The widget can be briefly high;
 *      it cannot be permanently wrong.
 *
 *   2. Nothing here is allowed to affect capture. NotificationListener calls
 *      recordDelta strictly after its persist -> notify -> dismiss sequence has
 *      completed, inside a catch-all. A widget that misses a redraw is
 *      cosmetic; a capture pipeline that misses a purchase is not.
 *
 * The category matcher below is deliberately the short version of
 * lib/hooks/useVendorMatcher.ts. Being a third copy of those rules is a real
 * cost, accepted only because the blast radius is one arc drawn in the wrong
 * colour for a few hours.
 */
final class WidgetDeltaStore {

    private WidgetDeltaStore() {}

    private static final String PREFS = "covault_prefs";
    static final String SNAPSHOT_KEY = "widget_snapshot";
    static final String DELTAS_KEY = "widget_deltas";
    static final String RULES_KEY = "widget_rules";

    /** Enough for a very heavy month between app launches. */
    private static final int MAX_DELTAS = 100;

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, 0);
    }

    // ── Snapshot ──────────────────────────────────────────────────────────

    static void writeSnapshot(Context context, String snapshotJson, String rulesJson) {
        SharedPreferences.Editor editor = prefs(context).edit();
        editor.putString(SNAPSHOT_KEY, snapshotJson);
        if (rulesJson != null) editor.putString(RULES_KEY, rulesJson);
        // A fresh snapshot supersedes every optimistic delta before it. Dropping
        // them here rather than filtering at render time keeps the store from
        // growing without bound on a device the app is rarely opened on.
        editor.remove(DELTAS_KEY);
        editor.commit();
    }

    static JSONObject readSnapshot(Context context) {
        String raw = prefs(context).getString(SNAPSHOT_KEY, null);
        if (raw == null) return null;
        try {
            return new JSONObject(raw);
        } catch (Exception e) {
            return null;
        }
    }

    // ── Deltas ────────────────────────────────────────────────────────────

    /**
     * Record a captured purchase. Returns false if nothing was stored, so the
     * caller can skip a pointless widget redraw.
     */
    static boolean recordDelta(Context context, double amount, String vendor, long atMs) {
        if (amount <= 0) return false;
        // No snapshot means the app has never written one — there is nothing to
        // add to, and inventing a baseline would show numbers that came from
        // nowhere.
        if (prefs(context).getString(SNAPSHOT_KEY, null) == null) return false;
        try {
            JSONArray deltas = readDeltas(context);
            JSONObject entry = new JSONObject();
            entry.put("amount", amount);
            entry.put("category", categoryFor(context, vendor));
            entry.put("atMs", atMs);
            deltas.put(entry);

            while (deltas.length() > MAX_DELTAS) deltas.remove(0);

            prefs(context).edit().putString(DELTAS_KEY, deltas.toString()).commit();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static JSONArray readDeltas(Context context) {
        try {
            return new JSONArray(prefs(context).getString(DELTAS_KEY, "[]"));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    /**
     * Fold applicable deltas into a copy of the snapshot for rendering.
     *
     * Mirrors mergeWidgetDeltas in lib/widgetSnapshot.ts, whose tests are the
     * specification for both.
     */
    static JSONObject mergeInto(Context context, JSONObject snapshot) {
        if (snapshot == null) return null;
        JSONArray deltas = readDeltas(context);
        if (deltas.length() == 0) return snapshot;

        long snapshotAt = snapshot.optLong("updatedAtMs", 0);
        String monthKey = snapshot.optString("monthKey", "");

        try {
            JSONArray slices = snapshot.optJSONArray("slices");
            if (slices == null) slices = new JSONArray();

            double totalSpent = snapshot.optDouble("totalSpent", 0);
            double added = 0;

            for (int i = 0; i < deltas.length(); i++) {
                JSONObject d = deltas.optJSONObject(i);
                if (d == null) continue;
                long atMs = d.optLong("atMs", 0);
                if (atMs <= snapshotAt) continue;
                if (!monthKey.equals(monthKeyOf(atMs))) continue;

                double amount = d.optDouble("amount", 0);
                if (amount <= 0) continue;
                String category = d.optString("category", "Other");

                added += amount;
                slices = addToSlice(slices, category, amount);
            }

            if (added == 0) return snapshot;

            JSONObject merged = new JSONObject(snapshot.toString());
            merged.put("totalSpent", totalSpent + added);
            merged.put("remaining", snapshot.optDouble("remaining", 0) - added);
            merged.put("slices", sortDescending(slices));
            return merged;
        } catch (Exception e) {
            // Rendering the un-merged snapshot is strictly better than failing.
            return snapshot;
        }
    }

    private static JSONArray addToSlice(JSONArray slices, String category, double amount) throws Exception {
        for (int i = 0; i < slices.length(); i++) {
            JSONObject s = slices.optJSONObject(i);
            if (s != null && category.equalsIgnoreCase(s.optString("name", ""))) {
                s.put("amount", s.optDouble("amount", 0) + amount);
                return slices;
            }
        }
        JSONObject fresh = new JSONObject();
        fresh.put("name", category);
        fresh.put("amount", amount);
        fresh.put("color", String.format(Locale.US, "#%06X",
            0xFFFFFF & WidgetRenderer.colorForCategory(category)));
        slices.put(fresh);
        return slices;
    }

    /** Largest first — the renderer drops icons from the tail. */
    private static JSONArray sortDescending(JSONArray slices) {
        java.util.List<JSONObject> list = new java.util.ArrayList<>();
        for (int i = 0; i < slices.length(); i++) {
            JSONObject o = slices.optJSONObject(i);
            if (o != null) list.add(o);
        }
        java.util.Collections.sort(list, (a, b) ->
            Double.compare(b.optDouble("amount", 0), a.optDouble("amount", 0)));
        return new JSONArray(list);
    }

    /** Local-time "YYYY-MM", matching getLocalMonthKey in lib/dateUtils.ts. */
    static String monthKeyOf(long atMs) {
        Calendar cal = Calendar.getInstance();
        cal.setTimeInMillis(atMs);
        return String.format(Locale.US, "%04d-%02d",
            cal.get(Calendar.YEAR), cal.get(Calendar.MONTH) + 1);
    }

    // ── Category matching ─────────────────────────────────────────────────

    /**
     * Resolve a vendor to a category using the rules the app mirrored here.
     *
     * Short version of useVendorMatcher: normalise, then exact / prefix /
     * contains. Anything unresolved lands in "Other", which is also what the
     * app's own pipeline does.
     */
    static String categoryFor(Context context, String vendor) {
        String key = normalize(vendor);
        if (key.isEmpty()) return "Other";
        try {
            JSONArray rules = new JSONArray(prefs(context).getString(RULES_KEY, "[]"));
            String contains = null;
            String prefix = null;
            for (int i = 0; i < rules.length(); i++) {
                JSONObject r = rules.optJSONObject(i);
                if (r == null) continue;
                String matchKey = normalize(r.optString("matchKey", ""));
                String category = r.optString("category", "");
                if (matchKey.isEmpty() || category.isEmpty()) continue;

                if (key.equals(matchKey)) return category;   // exact wins outright
                String type = r.optString("matchType", "");
                if ("prefix".equals(type) && key.startsWith(matchKey) && prefix == null) {
                    prefix = category;
                } else if (key.contains(matchKey) && contains == null) {
                    contains = category;
                }
            }
            if (prefix != null) return prefix;
            if (contains != null) return contains;
        } catch (Exception e) {
            // fall through
        }
        return "Other";
    }

    private static String normalize(String s) {
        if (s == null) return "";
        return s.toLowerCase(Locale.US).replaceAll("\\s+", "");
    }
}

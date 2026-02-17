package com.covault.app;

import android.app.Notification;
import android.content.Intent;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import org.json.JSONObject;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * NotificationListener service that captures banking app notifications
 * and extracts transaction data (amount, vendor) for auto-filing.
 */
public class NotificationListener extends NotificationListenerService {

    private static final String TAG = "CovaultNotificationListener";

    private static volatile NotificationListener instance;

    public static NotificationListener getInstance() {
        return instance;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (instance == this) {
            instance = null;
        }
    }

    /**
     * Re-process all active (currently visible) notifications from banking apps.
     * Called by the CovaultNotificationPlugin when the user taps the refresh button.
     * Refreshes the monitored apps list first to pick up any newly installed apps.
     */
    public void scanActiveNotifications() {
        try {
            StatusBarNotification[] activeNotifications = getActiveNotifications();
            if (activeNotifications == null) {
                Log.w(TAG, "scanActiveNotifications: no active notifications available");
                return;
            }
            Log.i(TAG, "scanActiveNotifications: scanning " + activeNotifications.length + " active notifications");
            for (StatusBarNotification sbn : activeNotifications) {
                // Re-use the same logic as onNotificationPosted
                onNotificationPosted(sbn);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error scanning active notifications", e);
        }
    }

    // Banking app package names to listen for
    // Users can configure which apps to monitor in the app
    static final Set<String> BANKING_APPS = new HashSet<>(Arrays.asList(
        // Major US Banks
        "com.chase.sig.android",           // Chase
        "com.wf.wellsfargomobile",          // Wells Fargo
        "com.infonow.bofa",                 // Bank of America
        "com.citi.citimobile",              // Citi
        "com.usbank.mobilebanking",         // US Bank
        "com.pnc.ecommerce.mobile",         // PNC
        "com.tdbank",                       // TD Bank
        "com.capitalone.mobile",            // Capital One (not credit card)
        "com.key.android",                  // KeyBank
        "com.regions.mobbanking",           // Regions
        "com.huntington.m",                 // Huntington
        "com.ally.MobileBanking",           // Ally Bank

        // Credit Cards
        "com.americanexpress.android.acctsvcs.us", // Amex
        "com.capitalone.creditcard.app",   // Capital One (credit card)
        "com.discoverfinancial.mobile",    // Discover
        "com.synchrony.banking",           // Synchrony

        // Neobanks & Fintech
        "com.chime.chmapplication",        // Chime
        "com.sofi.mobile",                 // SoFi
        "com.venmo",                       // Venmo
        "com.squareup.cash",               // Cash App
        "com.paypal.android.p2pmobile",    // PayPal
        "com.zellepay.zelle",              // Zelle
        "com.revolut.revolut",             // Revolut
        "com.simple",                      // Simple
        "com.monzo.android",               // Monzo
        "com.n26.android",                 // N26
        "com.varo",                        // Varo

        // Credit Unions (common ones)
        "com.navyfederal.android",         // Navy Federal
        "com.penfed.mobile.banking",       // PenFed
        "org.becu.mobile",                 // BECU

        // Canadian Banks
        "com.bmo.mobile",                  // BMO (Bank of Montreal)
        "com.rbc.mobile.android",          // RBC (Royal Bank of Canada)
        "com.td",                          // TD Canada
        "com.cibc.android.mobi",           // CIBC
        "com.scotiabank.mobile",           // Scotiabank
        "com.bns.mobile",                  // Scotiabank (alternate)
        "ca.bnc.android",                  // National Bank of Canada
        "com.desjardins.mobile",           // Desjardins
        "com.atb.atbmobile",              // ATB Financial
        "ca.tangerine.clients.banking",    // Tangerine
        "com.simplicite.app",              // Simplii Financial
        "ca.hsbc.hsbccanada",              // HSBC Canada
        "com.laurentianbank.mobile",       // Laurentian Bank
        "com.eq.mobile",                   // EQ Bank
        "com.manulife.mobile",             // Manulife Bank

        // Canadian Fintech / Neobanks
        "com.wealthsimple",               // Wealthsimple
        "com.wealthsimple.trade",          // Wealthsimple Trade
        "com.neofinancial.android",        // Neo Financial
        "com.koho.android",               // KOHO
        "com.mogo.mobile",                // Mogo

        // Canadian Payment / Transfer
        "ca.payments.interac",             // Interac e-Transfer

        // Investment/Trading (for cash accounts)
        "com.robinhood.android",           // Robinhood
        "com.fidelity.android",            // Fidelity
        "com.schwab.mobile",              // Charles Schwab
        "com.questrade.questmobile"        // Questrade
    ));

    // Patterns to extract transaction amount
    private static final Pattern[] AMOUNT_PATTERNS = {
        Pattern.compile("\\$([\\d,]+\\.\\d{2})"),                    // $123.45 (USD or CAD)
        Pattern.compile("(?:USD|CAD)\\s*([\\d,]+\\.\\d{2})"),        // USD 123.45 or CAD 123.45
        Pattern.compile("([\\d,]+\\.\\d{2})\\s*(?:USD|CAD|dollars?)"), // 123.45 USD/CAD
        Pattern.compile("(?:charged|spent|paid|purchase|transaction)\\s*(?:of)?\\s*\\$?([\\d,]+\\.\\d{2})", Pattern.CASE_INSENSITIVE),
        Pattern.compile("(?:amount|total)\\s*:?\\s*\\$?([\\d,]+\\.\\d{2})", Pattern.CASE_INSENSITIVE)
    };

    // Patterns to extract vendor/merchant name
    private static final Pattern[] VENDOR_PATTERNS = {
        Pattern.compile("(?:at|from|to|@)\\s+([A-Za-z0-9\\s&'.-]+?)\\s+(?:for|on|\\$|USD|CAD|charged)", Pattern.CASE_INSENSITIVE),
        Pattern.compile("(?:purchase|transaction|payment)\\s+(?:at|from)\\s+([A-Za-z0-9\\s&'.-]+)", Pattern.CASE_INSENSITIVE),
        Pattern.compile("([A-Z][A-Za-z0-9\\s&'.-]+?)\\s+\\$[\\d,]+\\.\\d{2}"),
        Pattern.compile("(?:merchant|vendor|store)\\s*:?\\s*([A-Za-z0-9\\s&'.-]+)", Pattern.CASE_INSENSITIVE)
    };

    // Keywords that indicate a transaction notification (not just a promo)
    private static final String[] TRANSACTION_KEYWORDS = {
        "purchase", "transaction", "charged", "spent", "paid", "payment",
        "withdrew", "withdrawal", "deposit", "transfer", "sent", "received",
        "debit", "credit", "authorized", "pending", "completed",
        "cost", "charge", "recurring"
    };

    /**
     * Load user-configured monitored apps from SharedPreferences.
     */
    private Set<String> getUserMonitoredApps() {
        try {
            String stored = getSharedPreferences("covault_prefs", 0)
                .getString("monitored_apps", "[]");
            Set<String> apps = new HashSet<>();
            org.json.JSONArray arr = new org.json.JSONArray(stored);
            for (int i = 0; i < arr.length(); i++) {
                String pkg = arr.optString(i, "").trim();
                if (!pkg.isEmpty()) {
                    apps.add(pkg);
                }
            }
            return apps;
        } catch (Exception e) {
            Log.w(TAG, "Error loading monitored apps", e);
            return new HashSet<>();
        }
    }

    /**
     * Check if a package is a monitored app (hardcoded banking apps OR user-configured).
     */
    private boolean isMonitoredApp(String packageName) {
        if (BANKING_APPS.contains(packageName)) return true;
        return getUserMonitoredApps().contains(packageName);
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        String packageName = sbn.getPackageName();

        // Ignore our own notifications (e.g. guide notification)
        if (packageName.equals(getPackageName())) {
            return;
        }

        Notification notification = sbn.getNotification();
        if (notification == null) return;

        Bundle extras = notification.extras;
        if (extras == null) return;

        // Extract notification text
        String title = extras.getString(Notification.EXTRA_TITLE, "");
        String text = extras.getString(Notification.EXTRA_TEXT, "");
        String bigText = extras.getString(Notification.EXTRA_BIG_TEXT, "");

        // Prefer bigText (expanded view) when available, otherwise use the
        // short text.  Concatenating both would duplicate content because
        // bigText typically contains the same message as text.
        String body = (bigText != null && !bigText.isEmpty()) ? bigText : text;
        String fullText = title + " " + body;

        // Forward any notification that looks financial: either from a known/
        // monitored banking app, OR contains a dollar amount.  The local
        // TypeScript pipeline handles classification and rejection.
        boolean fromMonitored = isMonitoredApp(packageName);
        boolean hasDollarAmount = extractAmount(fullText) != null;

        if (!fromMonitored && !hasDollarAmount) {
            return;
        }

        // Extract transaction data (best-effort; the local extraction
        // pipeline will handle extraction when native regex doesn't match)
        Double amount = extractAmount(fullText);
        String vendor = extractVendor(fullText);

        Log.i(TAG, "Financial notification from " + packageName + ": " + (amount != null ? "$" + amount : "[amount pending]") + " at " + (vendor != null ? vendor : "Unknown"));

        // Broadcast to the local TypeScript pipeline which will classify
        // as transaction or non-transaction — non-transactions will appear in
        // the rejected card so the user can see what was processed.
        broadcastTransaction(packageName, amount, vendor, fullText, sbn.getPostTime());
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {
        // Not needed for our use case
    }

    private boolean isTransactionNotification(String text) {
        String lowerText = text.toLowerCase();
        for (String keyword : TRANSACTION_KEYWORDS) {
            if (lowerText.contains(keyword)) {
                return true;
            }
        }
        // Also treat as a transaction if the notification contains a dollar amount.
        // Banking app notifications with dollar amounts are almost certainly transactions,
        // even without explicit keywords (e.g. Wealthsimple: "$12.34 at Tim Hortons").
        for (Pattern pattern : AMOUNT_PATTERNS) {
            if (pattern.matcher(text).find()) {
                return true;
            }
        }
        return false;
    }

    private Double extractAmount(String text) {
        for (Pattern pattern : AMOUNT_PATTERNS) {
            Matcher matcher = pattern.matcher(text);
            if (matcher.find()) {
                try {
                    String amountStr = matcher.group(1).replace(",", "");
                    return Double.parseDouble(amountStr);
                } catch (NumberFormatException e) {
                    Log.w(TAG, "Failed to parse amount: " + matcher.group(1));
                }
            }
        }
        return null;
    }

    private String extractVendor(String text) {
        for (Pattern pattern : VENDOR_PATTERNS) {
            Matcher matcher = pattern.matcher(text);
            if (matcher.find()) {
                String vendor = matcher.group(1).trim();
                // Clean up the vendor name
                vendor = vendor.replaceAll("\\s+", " ");
                if (vendor.length() > 2 && vendor.length() < 50) {
                    return vendor;
                }
            }
        }
        return null;
    }

    private void broadcastTransaction(String sourceApp, Double amount, String vendor, String rawText, long postTime) {
        try {
            JSONObject transaction = new JSONObject();
            transaction.put("source_app", sourceApp);
            if (amount != null) {
                transaction.put("amount", amount);
            }
            transaction.put("vendor", vendor != null ? vendor : "Unknown Merchant");
            transaction.put("raw_text", rawText);
            // Use the notification's original post time (stable across rescans)
            // instead of System.currentTimeMillis() which changes each time
            transaction.put("timestamp", postTime);

            // Broadcast to the app
            Intent intent = new Intent("com.covault.app.TRANSACTION_DETECTED");
            intent.putExtra("transaction_data", transaction.toString());
            intent.setPackage(getPackageName());
            sendBroadcast(intent);

            Log.i(TAG, "Broadcast transaction: " + transaction.toString());

        } catch (Exception e) {
            Log.e(TAG, "Error broadcasting transaction", e);
        }
    }
}

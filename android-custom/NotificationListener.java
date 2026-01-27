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

    // Banking app package names to listen for
    // Users can configure which apps to monitor in the app
    private static final Set<String> BANKING_APPS = new HashSet<>(Arrays.asList(
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

        // Investment/Trading (for cash accounts)
        "com.robinhood.android",           // Robinhood
        "com.fidelity.android",            // Fidelity
        "com.schwab.mobile"                // Charles Schwab
    ));

    // Patterns to extract transaction amount
    private static final Pattern[] AMOUNT_PATTERNS = {
        Pattern.compile("\\$([\\d,]+\\.\\d{2})"),                    // $123.45
        Pattern.compile("USD\\s*([\\d,]+\\.\\d{2})"),                // USD 123.45
        Pattern.compile("([\\d,]+\\.\\d{2})\\s*(?:USD|dollars?)"),   // 123.45 USD
        Pattern.compile("(?:charged|spent|paid|purchase|transaction)\\s*(?:of)?\\s*\\$?([\\d,]+\\.\\d{2})", Pattern.CASE_INSENSITIVE),
        Pattern.compile("(?:amount|total)\\s*:?\\s*\\$?([\\d,]+\\.\\d{2})", Pattern.CASE_INSENSITIVE)
    };

    // Patterns to extract vendor/merchant name
    private static final Pattern[] VENDOR_PATTERNS = {
        Pattern.compile("(?:at|from|to|@)\\s+([A-Za-z0-9\\s&'.-]+?)\\s+(?:for|on|\\$|USD|charged)", Pattern.CASE_INSENSITIVE),
        Pattern.compile("(?:purchase|transaction|payment)\\s+(?:at|from)\\s+([A-Za-z0-9\\s&'.-]+)", Pattern.CASE_INSENSITIVE),
        Pattern.compile("([A-Z][A-Za-z0-9\\s&'.-]+?)\\s+\\$[\\d,]+\\.\\d{2}"),
        Pattern.compile("(?:merchant|vendor|store)\\s*:?\\s*([A-Za-z0-9\\s&'.-]+)", Pattern.CASE_INSENSITIVE)
    };

    // Keywords that indicate a transaction notification (not just a promo)
    private static final String[] TRANSACTION_KEYWORDS = {
        "purchase", "transaction", "charged", "spent", "paid", "payment",
        "withdrew", "withdrawal", "deposit", "transfer", "sent", "received",
        "debit", "credit", "authorized", "pending", "completed"
    };

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        String packageName = sbn.getPackageName();

        // Only process notifications from banking apps
        if (!BANKING_APPS.contains(packageName)) {
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

        // Combine all text for parsing
        String fullText = title + " " + text + " " + bigText;

        // Check if this looks like a transaction notification
        if (!isTransactionNotification(fullText)) {
            Log.d(TAG, "Skipping non-transaction notification from " + packageName);
            return;
        }

        // Extract transaction data
        Double amount = extractAmount(fullText);
        String vendor = extractVendor(fullText);

        if (amount != null && amount > 0) {
            Log.i(TAG, "Transaction detected: $" + amount + " at " + (vendor != null ? vendor : "Unknown"));

            // Send to the web app via broadcast
            broadcastTransaction(packageName, amount, vendor, fullText);
        }
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

    private void broadcastTransaction(String sourceApp, Double amount, String vendor, String rawText) {
        try {
            JSONObject transaction = new JSONObject();
            transaction.put("source_app", sourceApp);
            transaction.put("amount", amount);
            transaction.put("vendor", vendor != null ? vendor : "Unknown Merchant");
            transaction.put("raw_text", rawText);
            transaction.put("timestamp", System.currentTimeMillis());

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

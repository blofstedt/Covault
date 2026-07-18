package com.covault.app.notification

import android.app.Notification
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.covault.app.data.repository.NotificationRepository
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Native Android service that receives every notification posted on
 * the device. Direct replacement for the Capacitor `@capacitor/local-notifications`
 * + `@capacitor/browser` notification-listener path the React app uses.
 *
 * Flow:
 *  1. Android calls [onNotificationPosted] for every notification
 *  2. We check if the posting app is a known bank app
 *  3. If yes, we hand off the raw notification text to
 *     [NotificationRepository.process] which runs the parser +
 *     dedup + insert pipeline
 *
 * The user must enable this service in:
 *   Settings -> Apps -> Special access -> Notification access -> Covault
 *
 * The dashboard surfaces a one-tap deep link to that settings screen
 * when the service isn't enabled (handled in the settings modal's
 * Notification listener section).
 */
@AndroidEntryPoint
class CovaultNotificationListener : NotificationListenerService() {

    @Inject lateinit var repository: NotificationRepository

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onBind(intent: Intent?): IBinder? {
        return super.onBind(intent)
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val pkg = sbn.packageName ?: return
        if (!BankAppCatalog.isBank(pkg)) return

        val notif: Notification = sbn.notification
        val extras = notif.extras
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty()
        val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString().orEmpty()
        val raw = listOf(title, text, bigText).filter { it.isNotBlank() }.joinToString(" • ")

        val timestamp = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            sbn.postTime
        } else {
            @Suppress("DEPRECATION")
            sbn.notification.`when`.takeIf { it > 0 } ?: System.currentTimeMillis()
        }

        scope.launch {
            // If we don't have a session, drop. The listener starts at
            // boot, before the user has signed in; we don't want to
            // parse ghost notifications against a null user.
            repository.process(
                packageName = pkg,
                rawText = raw,
                timestamp = timestamp,
            )
        }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        // No-op. We only care about new notifications.
    }
}

/**
 * Catalog of known bank app package names. The React app reads this
 * dynamically from the device; for Stage 6 we ship a static list of
 * the most common Canadian bank apps.
 */
object BankAppCatalog {
    private val PACKAGES = setOf(
        "com.rbc.mobile.android",
        "com.bmo.mobile",
        "com.td.apps",
        "com.scotiabank.mobile",
        "com.cibc.android.mobi",
        "com.intuit.mobile.bank.feed",
        "ca.bnc.android",
        "com.desjardins.mobile",
        "com.atb.atbapp",
        "com.simplii",
        "ca.tangerine.wallet",
        "com.wealthsimple",
    )
    fun isBank(packageName: String): Boolean = packageName in PACKAGES
}

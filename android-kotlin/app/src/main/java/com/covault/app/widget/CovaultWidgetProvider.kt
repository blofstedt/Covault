package com.covault.app.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import com.covault.app.MainActivity
import com.covault.app.R
import java.text.NumberFormat
import java.util.Date

class CovaultWidgetProvider : AppWidgetProvider() {

    companion object {
        const val ACTION_REFRESH = "com.covault.app.widget.REFRESH"
        const val ACTION_OPEN_APP = "com.covault.app.widget.OPEN_APP"

        fun updateAll(context: Context) {
            val appWidgetManager = AppWidgetManager.getInstance(context)
            val componentName = ComponentName(context, CovaultWidgetProvider::class.java)
            val appWidgetIds = appWidgetManager.getAppWidgetIds(componentName)
            for (appWidgetId in appWidgetIds) {
                updateWidget(context, appWidgetManager, appWidgetId)
            }
        }

        private fun updateWidget(
            context: Context,
            appWidgetManager: AppWidgetManager,
            appWidgetId: Int
        ) {
        val views = RemoteViews(context.packageName, R.layout.widget_covault)
        val data = WidgetDataStore.load(context)

        val currency = NumberFormat.getCurrencyInstance()

        // Balance
        views.setTextViewText(R.id.widget_balance, currency.format(data.remainingBalance))
        views.setTextColor(
            R.id.widget_balance,
            if (data.remainingBalance < 0)
                context.getColor(R.color.widget_red)
            else
                context.getColor(R.color.widget_green)
        )

        // Income
        views.setTextViewText(R.id.widget_income, "Income: ${currency.format(data.monthlyIncome)}")

        // Budget list — show top 4 budgets by spent amount
        val budgets = data.budgets.sortedByDescending { it.spent }.take(4)
        val budgetIds = listOf(
            R.id.widget_budget_1,
            R.id.widget_budget_2,
            R.id.widget_budget_3,
            R.id.widget_budget_4
        )

        for (i in budgetIds.indices) {
            val viewId = budgetIds[i]
            if (i < budgets.size) {
                val b = budgets[i]
                val pct = if (b.limit > 0) (b.spent / b.limit * 100).toInt() else 0
                views.setTextViewText(viewId, "${b.name}: ${currency.format(b.spent)} / ${currency.format(b.limit)} ($pct%)")
                views.setViewVisibility(viewId, android.view.View.VISIBLE)
            } else {
                views.setViewVisibility(viewId, android.view.View.GONE)
            }
        }

        // Updated time
        val updatedText = if (data.updatedAt > 0) {
            val diff = System.currentTimeMillis() - data.updatedAt
            val mins = diff / 60000
            when {
                mins < 1 -> "Just now"
                mins < 60 -> "$mins min ago"
                else -> "${mins / 60}h ago"
            }
        } else "Tap to sync"
        views.setTextViewText(R.id.widget_updated, updatedText)

        // Open app on tap
        val openIntent = Intent(context, MainActivity::class.java).apply {
            action = ACTION_OPEN_APP
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val openPending = PendingIntent.getActivity(
            context, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        views.setOnClickPendingIntent(R.id.widget_root, openPending)

        // Refresh button
        val refreshIntent = Intent(context, CovaultWidgetProvider::class.java).apply {
            action = ACTION_REFRESH
        }
        val refreshPending = PendingIntent.getBroadcast(
            context, appWidgetId, refreshIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        views.setOnClickPendingIntent(R.id.widget_refresh, refreshPending)

            appWidgetManager.updateAppWidget(appWidgetId, views)
        }
    }

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        for (appWidgetId in appWidgetIds) {
            updateWidget(context, appWidgetManager, appWidgetId)
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        when (intent.action) {
            ACTION_REFRESH -> {
                // Broadcast to app to refresh data; app should call WidgetDataStore.save()
                // and then updateAll() when data is ready
                val updateIntent = Intent(context, MainActivity::class.java).apply {
                    action = "com.covault.app.SYNC_WIDGET"
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                context.startActivity(updateIntent)
            }
        }
    }
}
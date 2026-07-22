package com.covault.app.widget

import android.content.Context
import com.covault.app.data.model.BudgetCategory
import com.covault.app.data.model.Transaction
import com.covault.app.domain.DashboardTotals
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Bridges dashboard data to the home-screen widget.
 * Called after every successful data refresh so the widget
 * always shows the latest balance and budget breakdown.
 */
@Singleton
class WidgetUpdater @Inject constructor(
    @ApplicationContext private val context: Context,
) {

    fun update(
        transactions: List<Transaction>,
        budgets: List<BudgetCategory>,
        monthlyIncome: Double,
    ) {
        val totals = DashboardTotals.compute(transactions, monthlyIncome)
        val widgetBudgets = budgets.map { b ->
            val spent = transactions
                .filter { it.budgetId == b.id && !it.isProjected && !it.isIncome }
                .sumOf { it.amount }
            WidgetBudgetData(
                name = b.name,
                spent = spent,
                limit = b.totalLimit,
            )
        }
        val data = WidgetData(
            remainingBalance = totals.remainingMoney,
            monthlyIncome = monthlyIncome,
            budgets = widgetBudgets,
            updatedAt = System.currentTimeMillis(),
        )
        WidgetDataStore.save(context, data)
        CovaultWidgetProvider.updateAll(context)
    }

    fun clear() {
        WidgetDataStore.clear(context)
        CovaultWidgetProvider.updateAll(context)
    }
}

package com.covault.app.domain

import com.covault.app.data.model.Transaction
import java.time.LocalDate

/**
 * Pure port of `components/dashboard_components/useDashboardTotals.ts`.
 * Computes the three values the dashboard renders:
 *
 *   - `currentMonthTransactions`: rows in the local-calendar month
 *   - `projectedTransactions`: future-dated recurring rows (Stage 6
 *     adds the real projection logic; for now it returns an empty list)
 *   - `remainingMoney`: monthlyIncome - spent - projected-current-month
 */
object DashboardTotals {

    data class Totals(
        val currentMonthTransactions: List<Transaction>,
        val projectedTransactions: List<Transaction>,
        val remainingMoney: Double,
    )

    fun compute(
        transactions: List<Transaction>,
        monthlyIncome: Double,
        now: LocalDate = LocalDate.now(),
    ): Totals {
        val monthKey = "%04d-%02d".format(now.year, now.monthValue)
        val current = transactions.filter {
            DateUtils.getLocalMonthKey(it.date) == monthKey
        }
        val projected = RecurringExecutor.computeFutureProjections(transactions, now)
        val projectedThisMonth = projected.filter {
            DateUtils.getLocalMonthKey(it.date) == monthKey
        }
        val spent = current.sumOf { it.amount }
        val projectedSpent = projectedThisMonth.sumOf { it.amount }
        return Totals(
            currentMonthTransactions = current,
            projectedTransactions = projected,
            remainingMoney = monthlyIncome - spent - projectedSpent,
        )
    }
}

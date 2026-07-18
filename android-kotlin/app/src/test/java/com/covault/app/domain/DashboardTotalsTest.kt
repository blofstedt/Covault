package com.covault.app.domain

import com.covault.app.data.model.Recurrence
import com.covault.app.data.model.Transaction
import com.covault.app.data.model.TransactionLabel
import com.covault.app.data.model.TransactionSource
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate

class DashboardTotalsTest {

    private val now = LocalDate.of(2026, 3, 15)

    @Test
    fun `empty input gives zero remaining`() {
        val t = DashboardTotals.compute(emptyList(), monthlyIncome = 5000.0, now = now)
        assertEquals(0, t.currentMonthTransactions.size)
        assertEquals(0, t.projectedTransactions.size)
        assertEquals(5000.0, t.remainingMoney, 0.0)
    }

    @Test
    fun `only-current-month transactions are included`() {
        val txs = listOf(
            tx("t-1", "2026-03-05", amount = -50.0),
            tx("t-2", "2026-02-28", amount = -100.0),  // last month
            tx("t-3", "2026-04-01", amount = -75.0),   // next month
        )
        val t = DashboardTotals.compute(txs, monthlyIncome = 1000.0, now = now)
        assertEquals(1, t.currentMonthTransactions.size)
        assertEquals(-50.0, t.currentMonthTransactions[0].amount, 0.0)
    }

    @Test
    fun `remaining = income - spent for current month`() {
        val txs = listOf(
            tx("t-1", "2026-03-05", amount = -300.0),
            tx("t-2", "2026-03-10", amount = -150.0),
            tx("t-3", "2026-02-28", amount = -500.0),  // not in current month
        )
        val t = DashboardTotals.compute(txs, monthlyIncome = 1000.0, now = now)
        assertEquals(550.0, t.remainingMoney, 0.0)
    }

    @Test
    fun `income transaction adds to remaining (negative amount)`() {
        // The React code treats tx.amount as signed: expenses are negative,
        // income is positive. So a $2000 paycheck + $300 expense = +1700.
        val txs = listOf(
            tx("t-1", "2026-03-05", amount = -300.0),
            tx("t-2", "2026-03-01", amount = 2000.0),
        )
        val t = DashboardTotals.compute(txs, monthlyIncome = 0.0, now = now)
        assertEquals(1700.0, t.remainingMoney, 0.0)
    }

    @Test
    fun `projected transactions list is empty until Stage 6`() {
        val txs = listOf(tx("t-1", "2026-03-05", amount = -50.0))
        val t = DashboardTotals.compute(txs, monthlyIncome = 1000.0, now = now)
        // The real projection lives in lib/projectedTransactions.ts which
        // depends on the recurring-executor flow (Stage 6). For now we
        // ship an empty list so the dashboard renders without a NPE.
        assertEquals(0, t.projectedTransactions.size)
    }

    private fun tx(id: String, date: String, amount: Double): Transaction = Transaction(
        id = id, userId = "u-1", vendor = "V", amount = amount,
        date = date, budgetId = "11111111-1111-1111-1111-111111111111",
        recurrence = Recurrence.ONE_TIME, label = TransactionLabel.MANUAL,
        isProjected = false, isIncome = amount > 0, caughtCleared = false,
        createdAt = date, source = TransactionSource.MANUAL,
    )
}

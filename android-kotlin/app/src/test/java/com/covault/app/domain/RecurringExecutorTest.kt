package com.covault.app.domain

import com.covault.app.data.model.Recurrence
import com.covault.app.data.model.SystemCategories
import com.covault.app.data.model.Transaction
import com.covault.app.data.model.TransactionLabel
import com.covault.app.data.model.TransactionSource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class RecurringExecutorTest {

    private val now = LocalDate.of(2026, 7, 15)

    @Test
    fun `monthly template produces a projection for next month`() {
        val t = monthlyRent().copy(date = "2026-07-01T12:00:00.000Z")
        val projections = RecurringExecutor.computeFutureProjections(listOf(t), now)
        // We expect a projection for Aug 1, Sep 1, Oct 1, Nov 1, Dec 1, Jan 1
        assertTrue(projections.isNotEmpty())
        assertTrue(projections.any { it.date.startsWith("2026-08-01") })
    }

    @Test
    fun `biweekly template advances by 2 weeks`() {
        val t = monthlyRent().copy(
            recurrence = Recurrence.BIWEEKLY,
            date = "2026-07-01T12:00:00.000Z",
        )
        val projections = RecurringExecutor.computeFutureProjections(listOf(t), now)
        assertTrue(projections.isNotEmpty())
        assertTrue(projections.any { it.date.startsWith("2026-07-15") })
    }

    @Test
    fun `projected id format includes template id and date`() {
        val t = monthlyRent().copy(date = "2026-07-01T12:00:00.000Z")
        val projections = RecurringExecutor.computeFutureProjections(listOf(t), now)
        assertTrue(projections.all { it.id.startsWith("projected-${t.id}-") })
    }

    @Test
    fun `projected rows are marked isProjected = true`() {
        val t = monthlyRent().copy(date = "2026-07-01T12:00:00.000Z")
        val projections = RecurringExecutor.computeFutureProjections(listOf(t), now)
        assertTrue(projections.all { it.isProjected })
    }

    @Test
    fun `no future projections when recurrence is One-time`() {
        val t = monthlyRent().copy(recurrence = Recurrence.ONE_TIME)
        val projections = RecurringExecutor.computeFutureProjections(listOf(t), now)
        assertEquals(0, projections.size)
    }

    private fun monthlyRent(): Transaction = Transaction(
        id = "t-rent", userId = "u-1", vendor = "Landlord",
        amount = -1500.0, date = "2026-07-01T12:00:00.000Z",
        budgetId = SystemCategories.HOUSING.id,
        recurrence = Recurrence.MONTHLY,
        label = TransactionLabel.AUTOMATIC,
        isProjected = false, isIncome = false, caughtCleared = false,
        createdAt = "2026-07-01T12:00:00.000Z",
        source = TransactionSource.MANUAL,
    )
}

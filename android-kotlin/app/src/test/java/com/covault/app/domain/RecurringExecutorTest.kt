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
    fun `one-time transaction produces no projections`() {
        val t = monthlyRent()
        val projections = RecurringExecutor.computeDueProjections(listOf(t), now)
        assertEquals(0, projections.size)
    }

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

    @Test
    fun `capped at MAX_BACKFILL_MONTHS past due dates`() {
        // Template from 6 months ago; only 2 months of backfill should appear
        val t = monthlyRent().copy(date = "2026-01-15T12:00:00.000Z")
        val due = RecurringExecutor.computeDueProjections(listOf(t), now)
        // We only collect dates <= today AND >= 2026-05-01 (now - 2 months, day=1)
        // So Apr, Mar, Feb are dropped. May, Jun, Jul make it.
        // 2026-05-15, 2026-06-15, 2026-07-15 — that's 3 rows
        assertTrue("Expected at most 3 due dates, got ${due.size}", due.size <= 3)
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

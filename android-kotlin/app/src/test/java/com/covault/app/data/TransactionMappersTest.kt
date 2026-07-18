package com.covault.app.data.remote

import com.covault.app.data.model.BudgetCategory
import com.covault.app.data.model.Recurrence
import com.covault.app.data.model.Transaction
import com.covault.app.data.model.TransactionLabel
import com.covault.app.data.model.TransactionSource
import com.covault.app.data.remote.dto.TransactionRow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.time.LocalDate

class TransactionMappersTest {

    private val budgets = listOf(
        BudgetCategory("11111111-1111-1111-1111-111111111111", "Housing", 1500.0),
        BudgetCategory("22222222-2222-2222-2222-222222222222", "Groceries", 500.0),
        BudgetCategory("custom-emergency-fund", "Emergency Fund", 200.0),
    )

    private val today: LocalDate = LocalDate.of(2026, 3, 20)

    // --- shouldSolidifyProjectedTransaction --------------------------------

    @Test
    fun `solidifies projected transactions dated today`() {
        assertTrue(TransactionMappers.shouldSolidifyProjectedTransaction(
            isProjected = true, transactionDate = "2026-03-20", now = today,
        ))
    }

    @Test
    fun `solidifies projected transactions dated before today`() {
        assertTrue(TransactionMappers.shouldSolidifyProjectedTransaction(
            isProjected = true, transactionDate = "2026-03-19", now = today,
        ))
    }

    @Test
    fun `does not solidify projected transactions dated after today`() {
        assertEquals(false, TransactionMappers.shouldSolidifyProjectedTransaction(
            isProjected = true, transactionDate = "2026-03-21", now = today,
        ))
    }

    @Test
    fun `does not solidify non-projected transactions`() {
        assertEquals(false, TransactionMappers.shouldSolidifyProjectedTransaction(
            isProjected = false, transactionDate = "2026-03-19", now = today,
        ))
    }

    // --- resolveBudgetIdFromRow --------------------------------------------

    @Test
    fun `returns null for rows with no budget field`() {
        val row = TransactionRow(
            id = "tx-1", userId = "u-1", vendor = "Amazon", amount = 10.0,
            date = "2026-03-20", isProjected = false, budget = "",
            type = "Manual", recur = "One-time",
        )
        assertNull(TransactionMappers.resolveBudgetIdFromRow(row))
    }

    @Test
    fun `maps known DB budget text to system UUID`() {
        val row = TransactionRow(
            id = "tx-1", userId = "u-1", vendor = "Rent", amount = 1500.0,
            date = "2026-03-01", isProjected = false, budget = "Housing",
            type = "Automatic", recur = "Monthly",
        )
        assertEquals("11111111-1111-1111-1111-111111111111",
            TransactionMappers.resolveBudgetIdFromRow(row))
    }

    @Test
    fun `maps unknown DB budget text to budget prefix format`() {
        val row = TransactionRow(
            id = "tx-1", userId = "u-1", vendor = "Misc", amount = 5.0,
            date = "2026-03-01", isProjected = false, budget = "Pet Care",
            type = "Manual", recur = "One-time",
        )
        assertEquals("budget:pet-care", TransactionMappers.resolveBudgetIdFromRow(row))
    }

    // --- resolveBudgetNameForInsert ----------------------------------------

    @Test
    fun `resolves system UUID directly to budget name`() {
        assertEquals("Housing", TransactionMappers.resolveBudgetNameForInsert(
            "11111111-1111-1111-1111-111111111111", budgets,
        ))
    }

    @Test
    fun `resolves budget prefix id to name when name match found`() {
        assertEquals("Housing", TransactionMappers.resolveBudgetNameForInsert(
            "budget:housing", budgets,
        ))
    }

    @Test
    fun `throws on null budget id`() {
        try {
            TransactionMappers.resolveBudgetNameForInsert(null, budgets)
            fail("Expected IllegalArgumentException")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("valid budget_id"))
        }
    }

    @Test
    fun `throws when budget id cannot be mapped to a known name`() {
        try {
            TransactionMappers.resolveBudgetNameForInsert("totally-unknown", budgets)
            fail("Expected IllegalArgumentException")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("Cannot map budget_id"))
        }
    }

    // --- toSupabaseRow -----------------------------------------------------

    @Test
    fun `toSupabaseRow produces only columns the live schema supports`() {
        val tx = Transaction(
            id = "tx-1", userId = "u-1", vendor = "Amazon", amount = 49.99,
            date = "2026-03-20T12:00:00.000Z",
            budgetId = "22222222-2222-2222-2222-222222222222",
            recurrence = Recurrence.ONE_TIME,
            label = TransactionLabel.AUTOMATIC,
            isProjected = false, isIncome = false, caughtCleared = false,
            createdAt = "2026-03-20T12:00:00.000Z",
            source = TransactionSource.NOTIFICATION,
        )
        val row = TransactionMappers.toSupabaseRow(tx, budgets)
        assertEquals("tx-1", row["id"])
        assertEquals("u-1", row["user_id"])
        assertEquals("Amazon", row["vendor"])
        assertEquals(49.99, row["amount"])
        assertEquals("2026-03-20", row["date"])  // stripped to YYYY-MM-DD
        assertEquals(false, row["is_projected"])
        assertEquals("Groceries", row["budget"])
        assertEquals("Automatic", row["type"])
        assertEquals("One-time", row["recur"])
        assertEquals("notification", row["source"])
    }

    @Test
    fun `toSupabaseRow omits source when caller did not set it`() {
        val tx = Transaction(
            id = "tx-1", userId = "u-1", vendor = "Amazon", amount = 10.0,
            date = "2026-03-20", budgetId = "11111111-1111-1111-1111-111111111111",
            createdAt = "2026-03-20",
        )
        val row = TransactionMappers.toSupabaseRow(tx, budgets)
        assertTrue("source should be absent when null", !row.containsKey("source"))
    }

    @Test
    fun `toSupabaseRow throws when budget_id is null`() {
        val tx = Transaction(
            id = "tx-1", userId = "u-1", vendor = "Amazon", amount = 10.0,
            date = "2026-03-20", budgetId = null, createdAt = "2026-03-20",
        )
        try {
            TransactionMappers.toSupabaseRow(tx, budgets)
            fail("Expected IllegalArgumentException")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("valid budget_id"))
        }
    }

    // --- fromSupabaseRow ---------------------------------------------------

    @Test
    fun `fromSupabaseRow normalizes date to noon-UTC ISO`() {
        val row = TransactionRow(
            id = "tx-1", userId = "u-1", vendor = "Amazon", amount = 49.99,
            date = "2026-03-20", isProjected = false, budget = "Groceries",
            type = "Automatic", recur = "One-time",
        )
        val tx = TransactionMappers.fromSupabaseRow(row)
        assertEquals("2026-03-20T12:00:00.000Z", tx.date)
    }

    @Test
    fun `fromSupabaseRow solidifies past projected transactions`() {
        val row = TransactionRow(
            id = "tx-1", userId = "u-1", vendor = "Rent", amount = 1500.0,
            date = "2026-03-01", isProjected = true, budget = "Housing",
            type = "Automatic", recur = "Monthly",
            createdAt = "2026-02-25T00:00:00.000Z",
        )
        val tx = TransactionMappers.fromSupabaseRow(row)
        assertEquals(false, tx.isProjected)
    }

    @Test
    fun `fromSupabaseRow maps Automatic label and One-time recurrence`() {
        val row = TransactionRow(
            id = "tx-1", userId = "u-1", vendor = "Amazon", amount = 10.0,
            date = "2026-03-20", isProjected = false, budget = "Groceries",
            type = "Automatic", recur = "One-time", source = "notification",
            createdAt = "2026-03-20T00:00:00.000Z",
        )
        val tx = TransactionMappers.fromSupabaseRow(row)
        assertEquals(TransactionLabel.AUTOMATIC, tx.label)
        assertEquals(Recurrence.ONE_TIME, tx.recurrence)
        assertEquals(TransactionSource.NOTIFICATION, tx.source)
        assertNotNull(tx.budgetId)
    }
}

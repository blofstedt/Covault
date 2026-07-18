package com.covault.app.domain

import com.covault.app.data.model.BudgetCategory
import com.covault.app.data.model.Recurrence
import com.covault.app.data.model.SystemCategories
import com.covault.app.data.model.Transaction
import com.covault.app.data.model.TransactionLabel
import com.covault.app.data.model.TransactionSource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class TransactionNormalizerTest {

    private val budgets = listOf(
        BudgetCategory("11111111-1111-1111-1111-111111111111", "Housing", 1500.0),
        BudgetCategory("22222222-2222-2222-2222-222222222222", "Groceries", 500.0),
        BudgetCategory(SystemCategories.OTHER.id, SystemCategories.OTHER.name, 200.0),
    )

    @Test
    fun `keeps a valid budget_id unchanged`() {
        val tx = newTx(id = "t-1", budgetId = "22222222-2222-2222-2222-222222222222")
        val result = TransactionNormalizer.normalize(listOf(tx), budgets)
        assertEquals("22222222-2222-2222-2222-222222222222", result[0].budgetId)
    }

    @Test
    fun `falls back to Other for an unknown budget_id`() {
        val tx = newTx(id = "t-2", budgetId = "budget:mystery")
        val result = TransactionNormalizer.normalize(listOf(tx), budgets)
        assertEquals(SystemCategories.OTHER.id, result[0].budgetId)
    }

    @Test
    fun `truncates date to 10 chars`() {
        val tx = newTx(id = "t-3", date = "2026-07-18T12:00:00.000Z", budgetId = null)
        val result = TransactionNormalizer.normalize(listOf(tx), budgets)
        assertEquals("2026-07-18", result[0].date)
    }

    @Test
    fun `replaces non-finite amount with zero`() {
        val tx = newTx(id = "t-4", budgetId = null).copy(amount = Double.NaN)
        val result = TransactionNormalizer.normalize(listOf(tx), budgets)
        assertEquals(0.0, result[0].amount, 0.0)
    }

    @Test
    fun `resolves budget prefix id by stripping and normalizing`() {
        val tx = newTx(id = "t-5", budgetId = "budget:groceries")
        val result = TransactionNormalizer.normalize(listOf(tx), budgets)
        // The prefix is normalized to "groceries" -> Groceries id
        assertEquals("22222222-2222-2222-2222-222222222222", result[0].budgetId)
    }

    @Test
    fun `null budget_id falls back to Other when present`() {
        val tx = newTx(id = "t-6", budgetId = null)
        val result = TransactionNormalizer.normalize(listOf(tx), budgets)
        assertEquals(SystemCategories.OTHER.id, result[0].budgetId)
    }

    @Test
    fun `preserves other transaction fields verbatim`() {
        val tx = Transaction(
            id = "t-7", userId = "u-1", vendor = "Amazon",
            amount = 49.99, date = "2026-07-18",
            budgetId = "22222222-2222-2222-2222-222222222222",
            recurrence = Recurrence.MONTHLY,
            label = TransactionLabel.AUTOMATIC,
            isProjected = true, isIncome = false, caughtCleared = false,
            userName = "Mavis", createdAt = "2026-07-18T12:00:00.000Z",
            source = TransactionSource.NOTIFICATION,
        )
        val result = TransactionNormalizer.normalize(listOf(tx), budgets)
        val out = result[0]
        assertEquals("Amazon", out.vendor)
        assertEquals(Recurrence.MONTHLY, out.recurrence)
        assertEquals(TransactionLabel.AUTOMATIC, out.label)
        assertEquals(true, out.isProjected)
        assertEquals(TransactionSource.NOTIFICATION, out.source)
    }

    @Test
    fun `multiple transactions normalize independently`() {
        val txs = listOf(
            newTx(id = "t-8a", budgetId = "22222222-2222-2222-2222-222222222222"),
            newTx(id = "t-8b", budgetId = "budget:housing"),
            newTx(id = "t-8c", budgetId = null),
        )
        val result = TransactionNormalizer.normalize(txs, budgets)
        assertNotEquals(result[0].budgetId, result[1].budgetId)
        assertEquals(SystemCategories.OTHER.id, result[2].budgetId)
    }

    private fun newTx(
        id: String,
        budgetId: String? = "22222222-2222-2222-2222-222222222222",
        date: String = "2026-07-18T12:00:00.000Z",
    ): Transaction = Transaction(
        id = id, userId = "u-1", vendor = "Amazon", amount = 10.0,
        date = date, budgetId = budgetId, createdAt = "2026-07-18T12:00:00.000Z",
    )
}

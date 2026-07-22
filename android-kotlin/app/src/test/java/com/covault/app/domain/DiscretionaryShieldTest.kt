package com.covault.app.domain

import com.covault.app.data.model.BudgetCategory
import com.covault.app.data.model.Transaction
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DiscretionaryShieldTest {

    private val budgets = listOf(
        BudgetCategory("b-groc", "Groceries", 100.0),
        BudgetCategory("b-trans", "Transport", 100.0),
        BudgetCategory("b-leis", "Leisure", 200.0),
    )

    private fun tx(id: String, budgetId: String, amount: Double) =
        Transaction(id = id, userId = "u", vendor = "v", amount = amount, date = "2026-03-05", budgetId = budgetId, createdAt = "2026-03-05")

    @Test
    fun `absorbed sums only over-limit amounts of non-leisure categories`() {
        val txs = listOf(
            tx("1", "b-groc", 130.0),   // 30 over
            tx("2", "b-trans", 80.0),   // under, contributes 0
            tx("3", "b-leis", 500.0),   // leisure itself ignored
        )
        assertEquals(30.0, DiscretionaryShield.absorbed(budgets, txs), 0.0)
    }

    @Test
    fun `apply sets leisure externalDeduction when enabled`() {
        val txs = listOf(tx("1", "b-groc", 150.0), tx("2", "b-trans", 140.0)) // 50 + 40 over
        val result = DiscretionaryShield.apply(budgets, txs, enabled = true)
        val leisure = result.first { it.name == "Leisure" }
        assertEquals(90.0, leisure.externalDeduction!!, 0.0)
        // non-leisure untouched
        assertNull(result.first { it.name == "Groceries" }.externalDeduction)
    }

    @Test
    fun `apply is a no-op when disabled`() {
        val txs = listOf(tx("1", "b-groc", 150.0))
        val result = DiscretionaryShield.apply(budgets, txs, enabled = false)
        assertNull(result.first { it.name == "Leisure" }.externalDeduction)
    }
}

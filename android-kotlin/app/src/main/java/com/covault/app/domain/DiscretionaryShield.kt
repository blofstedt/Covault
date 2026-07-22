package com.covault.app.domain

import com.covault.app.data.model.BudgetCategory
import com.covault.app.data.model.Transaction

/**
 * "Discretionary Shield": when enabled, the Leisure budget absorbs
 * overspending from every other category. Concretely, Leisure's
 * `externalDeduction` is set to the total over-limit amount across the
 * non-Leisure categories, so its remaining "fun money" shrinks to cover
 * overages before the overall number goes red.
 *
 * Overspend per category is computed the same way [BudgetSection] renders it
 * (sum of that budget's transaction amounts vs. its limit), so the shield and
 * the on-screen bars stay consistent regardless of the amount sign convention.
 * Pure and unit-tested.
 */
object DiscretionaryShield {

    private fun isLeisure(b: BudgetCategory) = b.name.contains("Leisure", ignoreCase = true)

    /** Total over-limit amount across non-Leisure categories (each clamped ≥ 0). */
    fun absorbed(budgets: List<BudgetCategory>, transactions: List<Transaction>): Double {
        val totalByBudget = transactions.groupBy { it.budgetId }
            .mapValues { (_, txs) -> txs.sumOf { it.amount } }
        return budgets
            .filterNot { isLeisure(it) }
            .sumOf { b -> maxOf(0.0, (totalByBudget[b.id] ?: 0.0) - b.totalLimit) }
    }

    /**
     * Returns [budgets] with Leisure's `externalDeduction` set to the absorbed
     * overspend when [enabled]; otherwise returns the list unchanged.
     */
    fun apply(
        budgets: List<BudgetCategory>,
        transactions: List<Transaction>,
        enabled: Boolean,
    ): List<BudgetCategory> {
        if (!enabled) return budgets
        val adjustment = absorbed(budgets, transactions)
        return budgets.map { b ->
            if (isLeisure(b)) b.copy(externalDeduction = adjustment) else b
        }
    }
}

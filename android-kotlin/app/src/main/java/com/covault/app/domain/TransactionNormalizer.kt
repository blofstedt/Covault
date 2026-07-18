package com.covault.app.domain

import com.covault.app.data.model.BudgetCategory
import com.covault.app.data.model.SystemCategories
import com.covault.app.data.model.Transaction

/**
 * Pure port of `components/dashboard_components/useNormalizedTransactions.ts`.
 *
 * The React function normalizes transactions so every row carries a
 * `budget_id` that matches one of the user's actual budget IDs. The
 * algorithm is messy because the DB has had several schema iterations
 * and old rows can carry `category_id` or a `Budget` enum value instead
 * of the current `budget_id` shape. We preserve the algorithm exactly.
 */
object TransactionNormalizer {

    fun normalize(
        transactions: List<Transaction>,
        budgets: List<BudgetCategory>,
    ): List<Transaction> {
        val budgetIds = mutableSetOf<String>()
        val budgetNameToId = mutableMapOf<String, String>()
        val systemCategoryIdToName = SystemCategories.ALL.associate {
            it.id.lowercase() to it.name.trim().lowercase()
        }
        val otherBudgetId = budgets
            .firstOrNull { it.name.equals("Other", ignoreCase = true) }
            ?.id

        for (b in budgets) {
            budgetIds.add(b.id)
            if (b.name.isNotBlank()) {
                budgetNameToId[b.name.trim().lowercase()] = b.id
            }
        }

        return transactions.map { tx ->
            val amount = tx.amount
            val date = tx.date.take(10)

            val budgetIdFromBudgetColumn = tx.budgetId
                ?.let { budgetNameToId[it.trim().lowercase()] }

            val budgetIdFromSystemCategory = tx.budgetId
                ?.lowercase()
                ?.let { systemCategoryIdToName[it] }
                ?.let { budgetNameToId[it] }

            val budgetIdFromPrefixed = tx.budgetId
                ?.takeIf { it.startsWith("budget:") }
                ?.let { budgetNameToId[it.removePrefix("budget:").replace("-", " ")] }

            val rawBudgetId = tx.budgetId?.takeIf { it in budgetIds }

            val resolved = budgetIdFromBudgetColumn
                ?: budgetIdFromSystemCategory
                ?: budgetIdFromPrefixed
                ?: rawBudgetId
                ?: otherBudgetId

            tx.copy(
                amount = if (amount.isFinite()) amount else 0.0,
                date = date,
                budgetId = resolved,
            )
        }
    }
}

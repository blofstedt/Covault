package com.covault.app.domain

import com.covault.app.data.model.BudgetCategory
import com.covault.app.data.model.Transaction

/**
 * Builds a CSV of transactions for the Settings → Export action. Pure and
 * unit-tested; the UI layer only handles the share intent. Columns:
 * Date, Vendor, Amount, Category, Type.
 */
object CsvExport {

    private const val HEADER = "Date,Vendor,Amount,Category,Type"

    fun toCsv(transactions: List<Transaction>, budgets: List<BudgetCategory>): String {
        val nameById = budgets.associate { it.id to it.name }
        val sb = StringBuilder(HEADER).append('\n')
        for (t in transactions) {
            val category = t.budgetId?.let { nameById[it] }.orEmpty()
            sb.append(escape(t.date.take(10))).append(',')
                .append(escape(t.vendor)).append(',')
                .append(t.amount.toString()).append(',')
                .append(escape(category)).append(',')
                .append(t.label.name)
                .append('\n')
        }
        return sb.toString()
    }

    /** RFC-4180 escaping: wrap in quotes and double embedded quotes when needed. */
    private fun escape(value: String): String =
        if (value.any { it == ',' || it == '"' || it == '\n' || it == '\r' }) {
            "\"" + value.replace("\"", "\"\"") + "\""
        } else {
            value
        }
}

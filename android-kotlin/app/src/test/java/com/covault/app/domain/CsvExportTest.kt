package com.covault.app.domain

import com.covault.app.data.model.BudgetCategory
import com.covault.app.data.model.Transaction
import com.covault.app.data.model.TransactionLabel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CsvExportTest {

    private val budgets = listOf(
        BudgetCategory(id = "b-groc", name = "Groceries", totalLimit = 500.0),
        BudgetCategory(id = "b-other", name = "Other", totalLimit = 500.0),
    )

    private fun tx(
        id: String,
        vendor: String,
        amount: Double,
        date: String = "2026-03-05T12:00:00.000Z",
        budgetId: String? = "b-groc",
        label: TransactionLabel = TransactionLabel.MANUAL,
    ) = Transaction(
        id = id, userId = "u", vendor = vendor, amount = amount, date = date,
        budgetId = budgetId, label = label, createdAt = date,
    )

    @Test
    fun `empty list is just the header`() {
        assertEquals("Date,Vendor,Amount,Category,Type\n", CsvExport.toCsv(emptyList(), budgets))
    }

    @Test
    fun `row maps category name and trims date`() {
        val csv = CsvExport.toCsv(listOf(tx("t1", "Whole Foods", -42.5)), budgets)
        val lines = csv.trim().split("\n")
        assertEquals(2, lines.size)
        assertEquals("2026-03-05,Whole Foods,-42.5,Groceries,MANUAL", lines[1])
    }

    @Test
    fun `vendor with comma is quoted`() {
        val csv = CsvExport.toCsv(listOf(tx("t1", "Acme, Inc", -10.0)), budgets)
        assertTrue(csv.contains("\"Acme, Inc\""))
    }

    @Test
    fun `unknown budget id yields empty category`() {
        val csv = CsvExport.toCsv(listOf(tx("t1", "Mystery", -5.0, budgetId = "nope")), budgets)
        assertTrue(csv.trim().endsWith("Mystery,-5.0,,MANUAL"))
    }
}

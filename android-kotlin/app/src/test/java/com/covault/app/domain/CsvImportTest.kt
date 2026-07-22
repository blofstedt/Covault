package com.covault.app.domain

import com.covault.app.data.model.BudgetCategory
import com.covault.app.data.model.TransactionLabel
import com.covault.app.data.model.TransactionSource
import org.junit.Assert.assertEquals
import org.junit.Test

class CsvImportTest {

    private val budgets = listOf(
        BudgetCategory("b-groc", "Groceries", 500.0),
        BudgetCategory("b-other", "Other", 500.0),
    )

    @Test
    fun `parses rows and skips header`() {
        val csv = """
            Date,Vendor,Amount,Category,Type
            2026-03-05,Whole Foods,-42.5,Groceries,MANUAL
            2026-03-06,Paycheck,1000.0,Other,AUTOMATIC
        """.trimIndent()
        val r = CsvImport.parse(csv, budgets, userId = "u", userName = "Me")
        assertEquals(2, r.transactions.size)
        assertEquals(0, r.skipped)
        val t0 = r.transactions[0]
        assertEquals("Whole Foods", t0.vendor)
        assertEquals(-42.5, t0.amount, 0.0)
        assertEquals("b-groc", t0.budgetId)
        assertEquals("2026-03-05T12:00:00.000Z", t0.date)
        assertEquals(TransactionSource.IMPORT, t0.source)
        assertEquals(TransactionLabel.AUTOMATIC, r.transactions[1].label)
    }

    @Test
    fun `unknown category maps to Other and bad amount is skipped`() {
        val csv = "2026-03-05,Mystery,notanumber,Nope,MANUAL\n2026-03-06,Cafe,-3.5,Nope,MANUAL"
        val r = CsvImport.parse(csv, budgets, userId = "u", userName = "Me")
        assertEquals(1, r.transactions.size)
        assertEquals(1, r.skipped)
        assertEquals("b-other", r.transactions[0].budgetId)
    }

    @Test
    fun `quoted field with comma is preserved`() {
        val csv = "2026-03-05,\"Acme, Inc\",-10.0,Groceries,MANUAL"
        val r = CsvImport.parse(csv, budgets, userId = "u", userName = "Me")
        assertEquals("Acme, Inc", r.transactions.single().vendor)
    }
}

package com.covault.app.domain

import com.covault.app.data.model.BudgetCategory
import com.covault.app.data.model.MatchType
import com.covault.app.data.model.VendorOverride
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CategoryResolverTest {

    private val groceries = BudgetCategory("b-groc", "Groceries", 500.0)
    private val transport = BudgetCategory("b-trans", "Transport", 500.0)
    private val budgets = listOf(groceries, transport)

    private fun override(
        proper: String,
        key: String = proper,
        type: MatchType = MatchType.EXACT,
        category: String = "Groceries",
    ) = VendorOverride(
        id = "id-$proper", properName = proper, matchKey = key,
        matchType = type, categoryName = category, updatedAt = null,
    )

    @Test
    fun `exact key match is confident and applied`() {
        val r = CategoryResolver.resolve("AMZN Mktp CA", listOf(override("Amazon", key = "amznmktpca")), budgets)
        assertEquals(CategoryResolver.Source.EXACT, r.source)
        assertEquals(groceries, r.budget)
    }

    @Test
    fun `prefix rule matches deterministically`() {
        val r = CategoryResolver.resolve(
            "UBER EATS 123", listOf(override("Uber", key = "uber", type = MatchType.PREFIX, category = "Transport")), budgets,
        )
        assertEquals(CategoryResolver.Source.EXACT, r.source)
        assertEquals(transport, r.budget)
    }

    @Test
    fun `fuzzy match suggests but is not confident`() {
        // EXACT-type rule keyed "starbucks"; the incoming key
        // "starbuckscoffee42" is not an exact key match, but the vendor
        // name contains "Starbucks" so fuzzy matching catches it.
        val r = CategoryResolver.resolve(
            "Starbucks Coffee 42",
            listOf(override("Starbucks", key = "starbucks", type = MatchType.EXACT, category = "Groceries")),
            budgets,
        )
        assertEquals(CategoryResolver.Source.FUZZY, r.source)
        assertEquals(groceries, r.budget)
    }

    @Test
    fun `no match yields none`() {
        val r = CategoryResolver.resolve("Totally Unknown Vendor", listOf(override("Amazon", key = "amazon")), budgets)
        assertEquals(CategoryResolver.Source.NONE, r.source)
        assertNull(r.budget)
    }

    @Test
    fun `empty vendor yields none`() {
        val r = CategoryResolver.resolve("   ", listOf(override("Amazon")), budgets)
        assertEquals(CategoryResolver.Source.NONE, r.source)
    }
}

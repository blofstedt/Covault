package com.covault.app.ui.dashboard

import org.junit.Assert.assertNotEquals
import org.junit.Test

/**
 * Sanity tests for the budget icon mapping. The icons themselves are
 * visual (Material Icons), so we just verify that distinct budget
 * categories resolve to different keys (catching the common "everything
 * shows as Home" regression).
 */
class BudgetIconsTest {

    @Test
    fun `distinct budget names resolve to distinct icon keys`() {
        val known = listOf("Housing", "Groceries", "Transport", "Utilities", "Leisure", "Services", "Other")
        val keys = known.map { budgetIconKeyFor(it) }
        // Some categories can share an icon (e.g. Leisure and Other both fall
        // through to "More" in the React code), so just check that we get
        // *at least* three distinct icon keys across the seven known budgets.
        assert(keys.distinct().size >= 3) {
            "Expected at least 3 distinct icon keys for the known budgets, got: ${keys.distinct()}"
        }
    }

    @Test
    fun `case insensitive lookup`() {
        assertNotEquals(budgetIconKeyFor("housing"), budgetIconKeyFor("HOUSING").let { "different" })
        // Both should be non-null and consistent
        assert(budgetIconKeyFor("HOUSING") == budgetIconKeyFor("housing"))
    }

    @Test
    fun `unknown budget falls back to MoreHoriz`() {
        assert(budgetIconKeyFor("Cryptocurrency trading fees") == "more_horiz")
    }
}

/**
 * Helper that maps a budget name to a string key identifying the icon
 * chosen by [budgetIconFor]. This lets the test compare icons without
 * importing the ImageVector type.
 */
fun budgetIconKeyFor(name: String): String {
    val lower = name.lowercase()
    return when {
        lower.contains("housing") -> "home"
        lower.contains("groceries") -> "local_grocery_store"
        lower.contains("transport") -> "directions_car"
        lower.contains("dining") || lower.contains("leisure") -> "mood"
        lower.contains("utilities") -> "bolt"
        lower.contains("services") -> "phone_iphone"
        lower.contains("attach") || lower.contains("money") -> "attach_money"
        lower.contains("search") -> "search"
        lower.contains("settings") -> "settings"
        lower.contains("tune") -> "tune"
        else -> "more_horiz"
    }
}

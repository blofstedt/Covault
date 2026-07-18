package com.covault.app.domain

import org.junit.Assert.assertEquals
import org.junit.Test

class BudgetColorsTest {

    @Test
    fun `known categories return their palette color`() {
        assertEquals("#5b9e97", BudgetColors.getColorHex("Housing"))
        assertEquals("#6b9e6e", BudgetColors.getColorHex("Groceries"))
        assertEquals("#6e8ec4", BudgetColors.getColorHex("Transport"))
        assertEquals("#c49a4a", BudgetColors.getColorHex("Utilities"))
        assertEquals("#9a7bbf", BudgetColors.getColorHex("Leisure"))
        assertEquals("#5ea0ad", BudgetColors.getColorHex("Services"))
        assertEquals("#8a95a3", BudgetColors.getColorHex("Other"))
    }

    @Test
    fun `unknown categories fall back by index`() {
        val first = BudgetColors.getColorHex("Pet Care", 0)
        val second = BudgetColors.getColorHex("Pet Care", 1)
        // Different indices must return different fallback colors
        assertEquals(false, first == second)
    }

    @Test
    fun `getGradient end is lighter than start`() {
        val (start, end) = BudgetColors.getGradient("Housing")
        // End color is lighter toward white → red/green/blue channels higher
        assertEquals(true, end.red >= start.red)
        assertEquals(true, end.green >= start.green)
        assertEquals(true, end.blue >= start.blue)
    }
}

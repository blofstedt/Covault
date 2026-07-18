package com.covault.app.domain

import androidx.compose.ui.graphics.Color

/**
 * Budget category color palette. Port of `lib/budgetColors.ts`.
 *
 * Each category gets a distinct color used consistently across budget
 * bars, icons, and charts. The colors are intentionally muted to match
 * the React app's Tailwind theme — Stage 4 will wire these into the
 * Compose Material 3 theme.
 */
object BudgetColors {

    /** Hex string values (so they match the React app verbatim). */
    val PALETTE: Map<String, String> = mapOf(
        "Housing"   to "#5b9e97", // muted teal
        "Groceries" to "#6b9e6e", // muted green
        "Transport" to "#6e8ec4", // muted blue
        "Utilities" to "#c49a4a", // muted amber
        "Leisure"   to "#9a7bbf", // muted purple
        "Services"  to "#5ea0ad", // muted cyan
        "Other"     to "#8a95a3", // muted slate
    )

    private val FALLBACK_HEX: List<String> = listOf(
        "#5b9e97", "#6b9e6e", "#6e8ec4", "#c49a4a",
        "#9a7bbf", "#5ea0ad", "#8a95a3", "#c48a5a",
    )

    /** Solid color for a category, falling back by index. */
    fun getColor(name: String, index: Int = 0): Color {
        val hex = PALETTE[name] ?: FALLBACK_HEX[index % FALLBACK_HEX.size]
        return parseHex(hex)
    }

    /** Hex string form of [getColor] for non-Compose callers. */
    fun getColorHex(name: String, index: Int = 0): String =
        PALETTE[name] ?: FALLBACK_HEX[index % FALLBACK_HEX.size]

    /** Gradient pair `[start, end]` for chart use. */
    fun getGradient(name: String, index: Int = 0): Pair<Color, Color> {
        val base = getColor(name, index)
        return base to lighten(base, 0.30f)
    }

    // ------------------------------------------------------------------------
    // Hex / Color helpers
    // ------------------------------------------------------------------------

    fun parseHex(hex: String): Color {
        val cleaned = hex.removePrefix("#")
        val long = cleaned.toLong(16)
        return when (cleaned.length) {
            6 -> Color(0xFF000000 or long)
            8 -> Color(long)
            else -> Color.Gray
        }
    }

    /**
     * Lighten [color] toward white by [amount] (0.0 = unchanged, 1.0 = white).
     * Mirrors the React `lightenColor(hex, percent)` helper.
     */
    fun lighten(color: Color, amount: Float): Color {
        val a = amount.coerceIn(0f, 1f)
        val r = color.red + (1f - color.red) * a
        val g = color.green + (1f - color.green) * a
        val b = color.blue + (1f - color.blue) * a
        return Color(r, g, b, color.alpha)
    }
}

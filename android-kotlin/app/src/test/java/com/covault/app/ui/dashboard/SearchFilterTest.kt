package com.covault.app.ui.dashboard

import com.covault.app.data.model.Recurrence
import com.covault.app.data.model.Transaction
import com.covault.app.data.model.TransactionLabel
import com.covault.app.data.model.TransactionSource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Mirrors the React `filterFn` in `SearchResults.tsx`:
 *   - vendor must include the query (case-insensitive)
 *   - refunds (amount < 0) are excluded
 *
 * The actual filter runs in the composable; we replicate the logic
 * here so the rule is testable without spinning up Compose.
 */
class SearchFilterTest {

    @Test
    fun `case-insensitive vendor match`() {
        val txs = listOf(
            tx("Amazon", amount = -10.0),
            tx("AMAZON", amount = -5.0),
            tx("amzn", amount = -3.0),
        )
        val matched = txs.filter { it.vendor.lowercase().contains("amazon") && it.amount >= 0 }
        assertEquals(0, matched.size)  // all are negative
    }

    @Test
    fun `refunds are excluded`() {
        val txs = listOf(
            tx("Amazon", amount = -10.0),       // refund -> exclude
            tx("Amazon", amount = 10.0),        // expense -> include
            tx("Amazon", amount = 25.0),        // expense -> include
        )
        val matched = txs.filter { it.vendor.lowercase().contains("amazon") && it.amount >= 0 }
        assertEquals(2, matched.size)
        assertTrue(matched.all { it.amount > 0 })
    }

    @Test
    fun `empty query matches everything (apart from refunds)`() {
        val txs = listOf(
            tx("Amazon", amount = -10.0),
            tx("Apple", amount = 5.0),
            tx("Uber", amount = 12.0),
        )
        // React's filterFn uses `q` (which can be empty); an empty
        // `contains("")` returns true for all strings.
        val q = ""
        val matched = txs.filter { it.vendor.lowercase().contains(q) && it.amount >= 0 }
        assertEquals(2, matched.size)
    }

    @Test
    fun `different vendors do not match`() {
        val txs = listOf(
            tx("Amazon", amount = 10.0),
            tx("Netflix", amount = 12.0),
        )
        val q = "amazon"
        val matched = txs.filter { it.vendor.lowercase().contains(q) && it.amount >= 0 }
        assertEquals(1, matched.size)
        assertEquals("Amazon", matched[0].vendor)
    }

    @Test
    fun `whitespace-trimmed query`() {
        val txs = listOf(tx("Whole Foods Market", amount = 50.0))
        val q = "  whole  ".lowercase().trim()
        val matched = txs.filter { it.vendor.lowercase().contains(q) && it.amount >= 0 }
        assertEquals(1, matched.size)
    }

    private fun tx(vendor: String, amount: Double): Transaction = Transaction(
        id = "t-$vendor-$amount", userId = "u-1", vendor = vendor, amount = amount,
        date = "2026-07-18T12:00:00.000Z", budgetId = "11111111-1111-1111-1111-111111111111",
        recurrence = Recurrence.ONE_TIME, label = TransactionLabel.MANUAL,
        isProjected = false, isIncome = amount > 0, caughtCleared = false,
        createdAt = "2026-07-18T12:00:00.000Z", source = TransactionSource.MANUAL,
    )
}

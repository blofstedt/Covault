package com.covault.app.domain

import com.covault.app.data.model.BudgetCategory
import com.covault.app.data.model.MatchType
import com.covault.app.data.model.VendorOverride

/**
 * Resolves a budget category for a captured/entered vendor from the learned
 * rules (vendor overrides), in the precedence the product wants:
 *
 *   1. Deterministic rule match (exact / prefix / contains) → apply it.
 *      A user-set exact-key rule wins over prefix/contains matches.
 *   2. Fuzzy match ([FormatVendorName.fuzzyVendorMatch]) → suggest it; the
 *      user can still change it.
 *   3. Nothing confident → no suggestion. The user categorizes, and that
 *      choice is learned as a new exact rule (see
 *      `VendorOverrideRepository.learn`) so it becomes a tier-1 match next time.
 *
 * Pure and unit-tested; the "AI" step is deterministic fuzzy string matching,
 * so no on-device model is required.
 */
object CategoryResolver {

    enum class Source { EXACT, FUZZY, NONE }

    data class Result(val budget: BudgetCategory?, val source: Source) {
        val isConfident: Boolean get() = source == Source.EXACT
    }

    fun vendorKey(vendor: String): String = vendor.lowercase().filter { it.isLetterOrDigit() }

    fun resolve(
        vendor: String,
        overrides: List<VendorOverride>,
        budgets: List<BudgetCategory>,
    ): Result {
        val key = vendorKey(vendor)
        if (key.isEmpty()) return Result(null, Source.NONE)

        // 1. Deterministic rule match. Prefer a user-set EXACT-type rule, then
        //    fall back to any prefix/contains rule that matches.
        val exactType = overrides.firstOrNull {
            it.matchType == MatchType.EXACT &&
                vendorKey(it.matchKey?.ifBlank { it.properName } ?: it.properName) == key
        }
        val deterministic = exactType ?: overrides.firstOrNull { deterministicMatch(it, key) }
        deterministic?.let { o -> budgetFor(o, budgets)?.let { return Result(it, Source.EXACT) } }

        // 2. Fuzzy similarity against known vendor names.
        val fuzzy = overrides.firstOrNull { o ->
            FormatVendorName.fuzzyVendorMatch(vendor, o.properName) ||
                (o.matchKey?.isNotBlank() == true && FormatVendorName.fuzzyVendorMatch(vendor, o.matchKey))
        }
        fuzzy?.let { o -> budgetFor(o, budgets)?.let { return Result(it, Source.FUZZY) } }

        return Result(null, Source.NONE)
    }

    private fun deterministicMatch(o: VendorOverride, key: String): Boolean {
        val pk = vendorKey(o.matchKey?.ifBlank { o.properName } ?: o.properName)
        if (pk.isEmpty()) return false
        return when (o.matchType) {
            MatchType.EXACT -> key == pk
            MatchType.PREFIX -> key.startsWith(pk)
            MatchType.CONTAINS -> key.contains(pk)
        }
    }

    private fun budgetFor(o: VendorOverride, budgets: List<BudgetCategory>): BudgetCategory? =
        budgets.firstOrNull { it.name.equals(o.categoryName, ignoreCase = true) }
}

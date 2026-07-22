package com.covault.app.data.model

/**
 * How the parser matches future notifications to a vendor override.
 * Mirrors `MatchType` in `components/transaction_parsing/useVendorOverrides.ts`.
 *
 *  - [EXACT]    : match_key equals the normalized incoming vendor
 *  - [PREFIX]   : incoming normalized vendor starts with match_key
 *  - [CONTAINS] : incoming normalized vendor contains match_key
 */
enum class MatchType(val dbValue: String) {
    EXACT("exact"),
    PREFIX("prefix"),
    CONTAINS("contains");

    companion object {
        fun fromDbValue(value: String?): MatchType = when (value) {
            "prefix" -> PREFIX
            "contains" -> CONTAINS
            else -> EXACT
        }
    }
}

/**
 * A single learned vendor→category mapping row (the `overrides` table).
 * Domain model equivalent of the React `VendorOverride` interface.
 *
 * A "Learned Rule" in the UI is a group of these that share the same
 * ([properName], [categoryName]) pair.
 */
data class VendorOverride(
    val id: String,
    /** Display name for the vendor, user-editable (e.g. "Amazon"). */
    val properName: String,
    /** Normalized raw vendor key used to match incoming transactions. */
    val matchKey: String?,
    val matchType: MatchType,
    /**
     * The category this vendor maps to. In the DB this is the `category_id`
     * column, which stores the `Budgets` enum *name* (e.g. "Groceries"),
     * not a UUID. Empty string when uncategorized.
     */
    val categoryName: String,
    /** Most recent update time (ISO), used for "most recent wins" ordering. */
    val updatedAt: String?,
)

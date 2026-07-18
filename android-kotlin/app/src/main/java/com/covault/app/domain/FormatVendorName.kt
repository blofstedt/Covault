package com.covault.app.domain

/**
 * Vendor string normalization and fuzzy matching. Direct port of
 * `lib/formatVendorName.ts`.
 *
 * Used by:
 *  - the dedup engine that decides if a new transaction matches a
 *    recurring template (Stage 6: notification-driven transactions)
 *  - the refund matcher (Stage 5/6: matching refunds to original charges)
 */
object FormatVendorName {

    /**
     * Format a vendor name to Title Case.
     * `"AMAZON"` -> `"Amazon"`, `"mCdOnAlDs"` -> `"Mcdonalds"`.
     */
    fun formatVendorName(name: String): String {
        if (name.isBlank()) return name.trim()
        return name.trim().split(Regex("\\s+"))
            .joinToString(" ") { word ->
                if (word.isEmpty()) word
                else word[0].uppercaseChar() + word.substring(1).lowercase()
            }
    }

    /**
     * Normalize a vendor string for duplicate detection. Strips common
     * bank-notification suffixes that vary between the auto-detected
     * charge and a manually entered template.
     */
    fun normalizeVendorForDedup(vendor: String?): String {
        if (vendor.isNullOrEmpty()) return ""
        var v = vendor.lowercase().trim()

        // Strip parenthetical suffixes: "(Tx. Incl.)", "(Auto)", "(Online)", etc.
        v = v.replace(Regex("\\s*\\([^)]*\\)\\s*"), " ")

        // Strip trailing transaction reference numbers
        v = v.replace(Regex("\\s*(?:ref|txn|transaction)[\\s#:]*\\d+\\s*$", RegexOption.IGNORE_CASE), "")

        // Strip trailing store/location/terminal identifiers
        v = v.replace(Regex("\\s*#\\s*\\d+\\s*$"), "")
        v = v.replace(Regex("\\s+(?:store|str|loc|location|terminal|tml|unit|kiosk)\\s*#?\\s*\\d*$", RegexOption.IGNORE_CASE), "")

        // Strip trailing Canadian province codes and common US state abbreviations
        v = v.replace(Regex("\\s+(?:ab|bc|mb|nb|nl|ns|nt|nu|on|pe|qc|sk|yt)\\s*$", RegexOption.IGNORE_CASE), "")
        v = v.replace(Regex("\\s+(?:ca|us|uk)\\s*$", RegexOption.IGNORE_CASE), "")

        // Collapse whitespace and keep only lowercase alphanumerics + spaces
        v = v.replace(Regex("\\s+"), " ").replace(Regex("[^a-z0-9 ]"), "").trim()
        return v
    }

    /**
     * Fuzzy-match two vendor names. See `lib/formatVendorName.ts` for the
     * matching policy (exact / contains / token-significant / Jaccard).
     */
    fun fuzzyVendorMatch(a: String, b: String): Boolean {
        if (a.isBlank() || b.isBlank()) return false

        val normA = a.lowercase().filter { it.isLetterOrDigit() }
        val normB = b.lowercase().filter { it.isLetterOrDigit() }

        if (normA == normB) return true
        if (normA.contains(normB) || normB.contains(normA)) return true

        val tokA = vendorTokens(a)
        val tokB = vendorTokens(b)
        if (tokA.isEmpty() || tokB.isEmpty()) return false

        val sigA = tokA.filter { it.length >= 4 }.toSet()
        val sigB = tokB.filter { it.length >= 4 }.toSet()

        // Any significant (4+ char) token overlap?
        for (t in sigA) {
            if (sigB.any { s -> s.contains(t) || t.contains(s) }) return true
        }
        for (t in sigB) {
            if (sigA.any { s -> s.contains(t) || t.contains(s) }) return true
        }

        // Jaccard on full token sets
        val setA = tokA.toSet()
        val setB = tokB.toSet()
        val intersection = setA.count { it in setB }
        val union = setA.size + setB.size - intersection
        return union > 0 && intersection.toDouble() / union >= 0.5
    }

    private fun vendorTokens(vendor: String): List<String> =
        vendor.lowercase()
            .replace(Regex("[^a-z0-9\\s]"), "")
            .split(Regex("\\s+"))
            .filter { it.isNotEmpty() }
}

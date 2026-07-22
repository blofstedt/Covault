package com.covault.app.data.remote

import com.covault.app.data.model.BudgetCategory
import com.covault.app.data.model.Recurrence
import com.covault.app.data.model.SubscriptionStatus
import com.covault.app.data.model.SystemCategories
import com.covault.app.data.model.Transaction
import com.covault.app.data.model.TransactionLabel
import com.covault.app.data.model.TransactionSource
import com.covault.app.data.model.User
import com.covault.app.data.remote.dto.BudgetRow
import com.covault.app.data.remote.dto.SettingsRow
import com.covault.app.data.remote.dto.TransactionRow
import com.covault.app.domain.DateUtils.toLocalIsoDay
import java.time.LocalDate
import java.time.format.DateTimeFormatter

/**
 * Conversion between Supabase row DTOs and the domain model the UI uses.
 * Direct port of `lib/hooks/transactionMappers.ts` and the relevant parts
 * of `lib/useAuthState.ts` / `lib/useUserData.ts`.
 *
 * All date string handling uses [DateUtils] to stay in the local calendar.
 */
object TransactionMappers {

    private val validRecurrences = setOf("One-time", "Biweekly", "Monthly")

    /**
     * True when a projected transaction has reached or passed today and
     * should be treated as a real (non-projected) row. Mirrors
     * `shouldSolidifyProjectedTransaction` in the React code.
     */
    fun shouldSolidifyProjectedTransaction(
        isProjected: Boolean,
        transactionDate: String,
        now: LocalDate = LocalDate.now(),
    ): Boolean {
        if (!isProjected) return false
        val txDay = parseIsoDay(transactionDate) ?: return false
        return !txDay.isAfter(now)
    }

    private fun parseIsoDay(value: String): LocalDate? {
        if (value.length >= 10) {
            return runCatching { LocalDate.parse(value.substring(0, 10)) }.getOrNull()
        }
        return null
    }

    /**
     * Resolve a transaction's `budget_id` (system UUID) from a Supabase
     * row's `budget` enum value. Returns null if the row has no budget
     * field — the caller is expected to reject the row in that case
     * (the React app's `toSupabaseTransaction` throws if budget_id is
     * missing on the outbound side).
     */
    fun resolveBudgetIdFromRow(row: TransactionRow): String? {
        val name = row.budget.takeIf { it.isNotBlank() } ?: return null
        val normalized = name.trim().lowercase()
        return SystemCategories.idForName(normalized)
            ?: "budget:${normalized.replace("\\s+".toRegex(), "-")}"
    }

    /**
     * Inverse of [resolveBudgetIdFromRow]. Throws if the budget_id cannot
     * be mapped to a valid `Budgets` enum value.
     */
    fun resolveBudgetNameForInsert(
        budgetId: String?,
        budgets: List<BudgetCategory> = emptyList(),
    ): String {
        require(!budgetId.isNullOrBlank()) {
            "Transaction must have a valid budget_id (category_id). Got: $budgetId"
        }
        budgets.firstOrNull { it.id == budgetId }?.name?.let { return it }

        val normalized = budgetId.trim().lowercase()
        budgets.firstOrNull { it.name.trim().lowercase() == normalized }?.name?.let { return it }

        if (budgetId.startsWith("budget:")) {
            val fromPrefixed = budgetId.removePrefix("budget:").replace("-", " ")
            budgets.firstOrNull { it.name.trim().lowercase() == fromPrefixed.trim().lowercase() }
                ?.name?.let { return it }
        }

        throw IllegalArgumentException(
            "Cannot map budget_id \"$budgetId\" to a valid budget name for transactions.budget"
        )
    }

    /**
     * Build the object Supabase expects for an insert/update. Only includes
     * columns that exist in the live `public.transactions` table.
     */
    fun toSupabaseRow(
        tx: Transaction,
        budgets: List<BudgetCategory> = emptyList(),
    ): Map<String, Any?> {
        val dateStr = tx.date.substring(0, 10)
        require(tx.budgetId != null) {
            "Transaction must have a valid budget_id (category_id). Got: ${tx.budgetId}"
        }

        val recurrence: String = if (tx.recurrence.dbValue in validRecurrences) {
            tx.recurrence.dbValue
        } else {
            Recurrence.ONE_TIME.dbValue
        }
        val budgetName = resolveBudgetNameForInsert(tx.budgetId, budgets)

        val row = mutableMapOf<String, Any?>(
            "id" to tx.id,
            "user_id" to tx.userId,
            "vendor" to tx.vendor,
            "amount" to tx.amount,
            "date" to dateStr,
            "is_projected" to (tx.isProjected),
            "budget" to budgetName,
            "type" to if (tx.label == TransactionLabel.AUTOMATIC) "Automatic" else "Manual",
            "recur" to recurrence,
        )
        tx.source?.let { row["source"] = it.name.lowercase() }
        return row
    }

    /**
     * Convert a Supabase row to the domain [Transaction]. The date string
     * is normalized to `YYYY-MM-DDT12:00:00.000Z` so that slicing to
     * 10 chars always yields the correct calendar date in every timezone
     * (matches the React `useFromSupabaseTransaction` behavior).
     */
    fun fromSupabaseRow(row: TransactionRow): Transaction {
        val recurrence = if (row.recur in validRecurrences) {
            Recurrence.fromDbValue(row.recur)
        } else {
            Recurrence.ONE_TIME
        }
        val shouldSolidify = shouldSolidifyProjectedTransaction(
            isProjected = row.isProjected,
            transactionDate = row.date,
        )

        val dateString: String = if (row.date.matches(Regex("^\\d{4}-\\d{2}-\\d{2}$"))) {
            row.date + "T12:00:00.000Z"
        } else {
            runCatching { LocalDate.parse(row.date.substring(0, 10))
                .atStartOfDay(java.time.ZoneOffset.UTC)
                .toInstant()
                .toString() }
                .getOrDefault(row.date)
        }

        return Transaction(
            id = row.id,
            userId = row.userId,
            vendor = row.vendor,
            amount = row.amount,
            date = dateString,
            budgetId = resolveBudgetIdFromRow(row),
            recurrence = recurrence,
            label = if (row.type == "Automatic") TransactionLabel.AUTOMATIC else TransactionLabel.MANUAL,
            isProjected = if (shouldSolidify) false else row.isProjected,
            isIncome = row.isIncome == true,
            caughtCleared = row.caughtCleared == true,
            userName = row.userName ?: "",
            createdAt = row.createdAt.orEmpty(),
            source = runCatching { TransactionSource.valueOf(row.source?.uppercase().orEmpty()) }
                .getOrNull(),
        )
    }

    // ------------------------------------------------------------------------
    // Settings / User mappers
    // ------------------------------------------------------------------------

    fun userFromSettings(row: SettingsRow): User = User(
        id = row.userId,
        name = row.name,
        email = row.email,
        partnerId = row.partnerId,
        partnerEmail = row.partnerEmail,
        partnerName = row.partnerName,
        hasJointAccounts = (row.partnerId != null),
        budgetingSolo = row.budgetingSolo ?: true,
        monthlyIncome = row.monthlyIncome ?: 0.0,
        trialStartedAt = row.trialStartedAt,
        trialEndsAt = row.trialEndsAt,
        trialConsumed = row.trialConsumed == true,
        subscriptionStatus = when (row.subscriptionStatus) {
            "active" -> SubscriptionStatus.ACTIVE
            "expired" -> SubscriptionStatus.EXPIRED
            else -> SubscriptionStatus.NONE
        },
    )

    fun budgetCategoryFromRow(row: BudgetRow): BudgetCategory? {
        val id = SystemCategories.idForName(row.budget) ?: return null
        return BudgetCategory(
            id = id,
            name = SystemCategories.nameForId(id) ?: return null,
            totalLimit = row.amount,
        )
    }
}

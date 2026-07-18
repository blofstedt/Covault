package com.covault.app.data.repository

import com.covault.app.data.model.BudgetCategory
import com.covault.app.data.model.PendingTransaction
import com.covault.app.data.model.SystemCategories
import com.covault.app.data.model.Transaction
import com.covault.app.data.model.User
import com.covault.app.data.remote.TransactionMappers
import com.covault.app.data.remote.dto.BudgetRow
import com.covault.app.data.remote.dto.PendingTransactionRow
import com.covault.app.data.remote.dto.SettingsRow
import com.covault.app.data.remote.dto.TransactionRow
import com.covault.app.domain.DateUtils
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.postgrest
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Loads all of a user's data from Supabase in one call. Direct port of
 * `lib/hooks/useDataLoading.ts` and the `loadUserData` orchestrator in
 * `lib/hooks/useUserData.ts`.
 *
 * Returns the loaded state as a [UserData] value object rather than
 * mutating a shared `AppState` — the caller (a ViewModel) owns the
 * state container. This keeps the repository pure and testable.
 */
@Singleton
class UserDataRepository @Inject constructor(
    private val supabase: SupabaseClient,
) {

    data class UserData(
        val user: User,
        val budgets: List<BudgetCategory>,
        val transactions: List<Transaction>,
        val pendingTransactions: List<PendingTransaction>,
    )

    /**
     * Load everything for the given user. Always returns a [UserData]
     * even if some sub-loads fail — the caller decides how to surface
     * errors. Default budgets are filled in when the user has no
     * `budgets` rows yet.
     *
     * Mirrors the React `loadUserData` orchestration:
     *   loadCategories -> loadUserBudgets -> loadUserSettings
     *   -> loadTransactions -> loadPendingTransactions
     *   -> loadHouseholdLink -> remapOrphanedTransactions
     */
    suspend fun loadUserData(userId: String): UserData {
        val budgets = loadBudgets(userId)
        val settings = loadSettingsRow(userId)
        val transactions = loadTransactions(userId)
        val pending = loadPendingTransactions(userId)
        val (user, finalBudgets, finalTransactions) = applyHouseholdAndRemap(
            userId = userId,
            settings = settings,
            initialBudgets = budgets,
            initialTransactions = transactions,
        )
        return UserData(
            user = user,
            budgets = finalBudgets,
            transactions = finalTransactions,
            pendingTransactions = pending,
        )
    }

    // -- Budgets ----------------------------------------------------------

    private suspend fun loadBudgets(userId: String): List<BudgetCategory> {
        val rows = runCatching {
            supabase.postgrest["budgets"]
                .select {
                    filter { eq("user_uuid", userId) }
                }
                .decodeList<BudgetRow>()
        }.getOrNull().orEmpty()

        if (rows.isEmpty()) {
            // Ensure defaults exist in the DB so subsequent reads return them
            ensureDefaultBudgets(userId, emptySet())
            return SystemCategories.ALL
        }

        val loadedNames = mutableSetOf<String>()
        val result = rows.mapNotNull { row ->
            TransactionMappers.budgetCategoryFromRow(row)
        }.also { loadedNames.addAll(it.map { b -> b.name }) }

        // Seed any system categories the user doesn't have yet
        val missing = SystemCategories.ALL
            .filter { it.name !in loadedNames }
            .map { it.name }
            .toSet()
        if (missing.isNotEmpty()) ensureDefaultBudgets(userId, missing)

        return (result + SystemCategories.ALL.filter { it.name !in loadedNames })
            .distinctBy { it.id }
    }

    private suspend fun ensureDefaultBudgets(userId: String, existing: Set<String>) {
        val missing = SystemCategories.ALL.filter { it.name !in existing }
        if (missing.isEmpty()) return
        val rows = missing.map {
            BudgetRow(
                userUuid = userId,
                budget = it.name,
                amount = it.totalLimit,
                visible = true,
            )
        }
        runCatching {
            supabase.postgrest["budgets"].insert(rows)
        }
    }

    // -- Settings / user merge -------------------------------------------

    private suspend fun loadSettingsRow(userId: String): SettingsRow? {
        return runCatching {
            supabase.postgrest["settings"]
                .select {
                    filter { eq("user_id", userId) }
                    limit(1)
                }
                .decodeSingleOrNull<SettingsRow>()
        }.getOrNull()
    }

    // -- Transactions -----------------------------------------------------

    suspend fun loadTransactions(userId: String): List<Transaction> {
        val rows = runCatching {
            supabase.postgrest["transactions"]
                .select {
                    filter { eq("user_id", userId) }
                    order("date", io.github.jan.supabase.postgrest.query.Order.DESCENDING)
                }
                .decodeList<TransactionRow>()
        }.getOrElse { return emptyList() }

        return rows.mapNotNull { row ->
            runCatching { TransactionMappers.fromSupabaseRow(row) }
                .onFailure { e ->
                    android.util.Log.w("UserDataRepository",
                        "Skipping invalid transaction row ${row.id}: ${e.message}")
                }
                .getOrNull()
        }
    }

    // -- Pending transactions --------------------------------------------

    private suspend fun loadPendingTransactions(userId: String): List<PendingTransaction> {
        val rows = runCatching {
            supabase.postgrest["pending_transactions"]
                .select {
                    filter {
                        eq("user_id", userId)
                        eq("status", "pending")
                    }
                    order("created_at", io.github.jan.supabase.postgrest.query.Order.DESCENDING)
                }
                .decodeList<PendingTransactionRow>()
        }.getOrNull().orEmpty()

        return rows.map { row ->
            PendingTransaction(
                id = row.id,
                userId = row.userId,
                appPackage = row.appPackage,
                appName = row.appName,
                notificationTimestamp = row.notificationTimestamp,
                postedAt = row.postedAt,
                extractedVendor = row.extractedVendor,
                extractedAmount = row.extractedAmount,
                extractedTimestamp = row.extractedTimestamp,
                confidence = row.confidence,
                status = com.covault.app.data.model.PendingStatus.PENDING,
                rejectionReason = row.rejectionReason,
                createdAt = row.createdAt,
                reviewedAt = row.reviewedAt,
            )
        }
    }

    // -- Household linking + orphan remap --------------------------------

    private suspend fun applyHouseholdAndRemap(
        userId: String,
        settings: SettingsRow?,
        initialBudgets: List<BudgetCategory>,
        initialTransactions: List<Transaction>,
    ): Triple<User, List<BudgetCategory>, List<Transaction>> {
        // 1. Build the user from the settings row. If the row is missing,
        //    we return a "minimal" user and let the dashboard surface a
        //    "complete onboarding" affordance (Stage 4b).
        val baseUser: User = settings?.let { TransactionMappers.userFromSettings(it) }
            ?: User(id = userId, name = "User", email = "")

        // 2. Household: if settings has a partner_id, merge their tx.
        val (user, transactions) = if (settings?.partnerId != null) {
            val partner = loadTransactions(settings.partnerId)
            val merged = (initialTransactions + partner).distinctBy { it.id }
            baseUser.copy(
                budgetingSolo = false,
                hasJointAccounts = true,
                partnerId = settings.partnerId,
                partnerName = settings.partnerName,
                partnerEmail = settings.partnerEmail,
            ) to merged
        } else baseUser to initialTransactions

        // 3. Remap orphaned budget_id values (partner's IDs → our IDs).
        val userBudgetIds = initialBudgets.map { it.id }.toSet()
        val remapped = transactions.map { tx ->
            if (tx.budgetId == null || tx.budgetId in userBudgetIds) tx
            else {
                val resolved = initialBudgets.firstOrNull { b ->
                    b.name.equals(SystemCategories.nameForId(tx.budgetId), ignoreCase = true)
                }?.id ?: SystemCategories.idForName(
                    tx.budgetId.removePrefix("budget:").replace("-", " ")
                )
                tx.copy(budgetId = resolved)
            }
        }
        return Triple(user, initialBudgets, remapped)
    }
}

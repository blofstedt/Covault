package com.covault.app.data.repository

import com.covault.app.data.model.BudgetCategory
import com.covault.app.data.model.Transaction
import com.covault.app.data.remote.TransactionMappers
import com.covault.app.domain.RecurringExecutor
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.postgrest
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Recurring-transaction executor. Direct port of
 * `lib/recurringExecutor.ts`'s `executeRecurringTransactions` +
 * `sendRecurringCatchUpNotification` flows.
 *
 * Triggered on:
 *  - App open (called from `UserDataRepository.loadUserData`)
 *  - Notification listener events (called from `NotificationRepository.process`)
 *  - Manual pull-to-refresh in the dashboard
 *
 * Persists projected rows to the `transactions` table with
 * `is_projected = true` and a `projected-{template_id}-{date}` id.
 * The dashboard's `DashboardTotals` then folds the projection into
 * `remainingMoney`.
 */
@Singleton
class RecurringRepository @Inject constructor(
    private val supabase: SupabaseClient,
) {

    /**
     * Run the executor. Returns the list of newly-inserted projected
     * transactions.
     */
    suspend fun execute(
        userId: String,
        transactions: List<Transaction>,
        budgets: List<BudgetCategory>,
    ): Result<List<Transaction>> = runCatching {
        val today = java.time.LocalDate.now()
        val due = RecurringExecutor.computeDueProjections(transactions, today)
        val existingIds = transactions.map { it.id }.toSet()
        val newRows = due.filter { it.id !in existingIds }
        if (newRows.isEmpty()) return@runCatching emptyList()

        val inserted = supabase.postgrest["transactions"].insert(
            newRows.map { TransactionMappers.toSupabaseRow(it, budgets) }
        ).decodeList<com.covault.app.data.remote.dto.TransactionRow>()

        inserted.map { TransactionMappers.fromSupabaseRow(it) }
    }
}

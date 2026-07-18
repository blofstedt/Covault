package com.covault.app.data.repository

import com.covault.app.data.model.BudgetCategory
import com.covault.app.data.model.Recurrence
import com.covault.app.data.model.Transaction
import com.covault.app.data.model.TransactionLabel
import com.covault.app.data.model.TransactionSource
import com.covault.app.data.remote.TransactionMappers
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.postgrest
import java.time.LocalDate
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Transaction CRUD. Direct port of the `handleAddTransaction` /
 * `handleUpdateTransaction` / `handleDeleteTransaction` paths in
 * `lib/hooks/useTransactionOps.ts`.
 *
 * Unlike the React app, this repository does NOT do optimistic UI
 * updates — it returns the result and lets the ViewModel decide
 * how to apply it to its state. This is a deliberate Kotlin-side
 * simplification: the React code mutates a useState-backed AppState
 * directly, which makes the call sites hard to test. The repository
 * is pure: take a Transaction, return a Result.
 */
@Singleton
class TransactionRepository @Inject constructor(
    private val supabase: SupabaseClient,
) {

    suspend fun add(
        tx: Transaction,
        budgets: List<BudgetCategory>,
    ): Result<Transaction> = runCatching {
        val row = TransactionMappers.toSupabaseRow(tx, budgets).toMutableMap()
        if (tx.id.isBlank()) row["id"] = UUID.randomUUID().toString()
        if (tx.label == TransactionLabel.AUTOMATIC) row["caught_cleared"] = false
        if (tx.source == null) row["source"] = TransactionSource.MANUAL.name.lowercase()

        val inserted = supabase.postgrest["transactions"]
            .insert(row)
            .decodeSingle<com.covault.app.data.remote.dto.TransactionRow>()
        TransactionMappers.fromSupabaseRow(inserted)
    }

    suspend fun update(
        tx: Transaction,
        budgets: List<BudgetCategory>,
    ): Result<Transaction> = runCatching {
        val row = TransactionMappers.toSupabaseRow(tx, budgets)
        val updated = supabase.postgrest["transactions"]
            .update(row) {
                filter { eq("id", tx.id) }
            }
            .decodeSingle<com.covault.app.data.remote.dto.TransactionRow>()
        TransactionMappers.fromSupabaseRow(updated)
    }

    suspend fun delete(transactionId: String): Result<Unit> = runCatching {
        supabase.postgrest["transactions"].delete {
            filter { eq("id", transactionId) }
        }
    }

    /**
     * Persist a new manually-entered transaction. Fills in id +
     * userName + source defaults the React form sets manually.
     */
    suspend fun addManual(
        userId: String,
        userName: String,
        vendor: String,
        amount: Double,
        budgetId: String,
        date: LocalDate,
        isIncome: Boolean = false,
        budgets: List<BudgetCategory>,
    ): Result<Transaction> {
        val tx = Transaction(
            id = UUID.randomUUID().toString(),
            userId = userId,
            vendor = vendor,
            amount = amount,
            date = com.covault.app.domain.DateUtils.toLocalIsoDay(date) + "T12:00:00.000Z",
            budgetId = budgetId,
            recurrence = Recurrence.ONE_TIME,
            label = TransactionLabel.MANUAL,
            isProjected = false,
            isIncome = isIncome,
            caughtCleared = false,
            userName = userName,
            createdAt = java.time.Instant.now().toString(),
            source = TransactionSource.MANUAL,
        )
        return add(tx, budgets)
    }
}

package com.covault.app.data.repository

import com.covault.app.data.model.BudgetCategory
import com.covault.app.data.remote.TransactionMappers
import com.covault.app.data.remote.dto.BudgetRow
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.postgrest
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Per-user budget CRUD. Direct port of `saveBudgetLimit` /
 * `saveBudgetVisibility` in `lib/hooks/useUserSettings.ts`.
 *
 * The `budgets` table layout is:
 *   user_uuid: uuid
 *   budget:    "Budgets" enum value
 *   amount:    numeric
 *   visible:   boolean (default true)
 */
@Singleton
class BudgetRepository @Inject constructor(
    private val supabase: SupabaseClient,
) {

    suspend fun loadAll(userId: String): List<BudgetCategory> = runCatching {
        supabase.postgrest["budgets"]
            .select { filter { eq("user_uuid", userId) } }
            .decodeList<BudgetRow>()
    }.getOrNull().orEmpty().mapNotNull {
        TransactionMappers.budgetCategoryFromRow(it)
    }

    suspend fun upsertLimit(userId: String, budgetName: String, amount: Double): Result<Unit> =
        runCatching {
            supabase.postgrest["budgets"].upsert(
                BudgetRow(
                    userUuid = userId,
                    budget = budgetName,
                    amount = amount,
                    visible = true,
                )
            ) {
                onConflict = "user_uuid,budget"
            }
        }

    suspend fun upsertVisibility(
        userId: String,
        budgetName: String,
        visible: Boolean,
    ): Result<Unit> = runCatching {
        supabase.postgrest["budgets"].upsert(
            BudgetRow(
                userUuid = userId,
                budget = budgetName,
                amount = 0.0,            // amount is required (NOT NULL); 0 is harmless
                visible = visible,
            )
        ) {
            onConflict = "user_uuid,budget"
        }
    }
}

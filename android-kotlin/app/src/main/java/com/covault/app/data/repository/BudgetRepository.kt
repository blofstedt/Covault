package com.covault.app.data.repository

import com.covault.app.data.remote.dto.BudgetRow
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.postgrest
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Budget-limit writes. Reads happen in [UserDataRepository.loadBudgets],
 * which also seeds the 7 system categories on first run.
 *
 * The `budgets` table layout is:
 *   user_uuid: uuid
 *   budget:    "Budgets" enum value (the category NAME, e.g. "Groceries")
 *   amount:    numeric
 *   visible:   boolean (default true; no UI uses it yet)
 */
@Singleton
class BudgetRepository @Inject constructor(
    private val supabase: SupabaseClient,
) {

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
}

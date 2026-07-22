package com.covault.app.data.repository

import com.covault.app.data.model.MatchType
import com.covault.app.data.model.VendorOverride
import com.covault.app.data.remote.dto.VendorOverrideRow
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.postgrest
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Per-user vendor override ("learned rule") CRUD. Direct port of the
 * persistence half of `components/transaction_parsing/useVendorOverrides.ts`.
 *
 * The PostgREST resource is `overrides`. Columns:
 *   id           uuid
 *   user_id      uuid
 *   proper_name  text   (display name, e.g. "Amazon")
 *   match_key    text   (normalized raw vendor key)
 *   match_type   text   (exact | prefix | contains)
 *   category_id  text   (the "Budgets" enum NAME, e.g. "Groceries")
 *   updated_at   timestamptz
 *
 * Unlike the React hook this repository is pure: it performs the DB write
 * and returns a [Result]; the ViewModel owns optimistic UI state.
 */
@Singleton
class VendorOverrideRepository @Inject constructor(
    private val supabase: SupabaseClient,
) {

    suspend fun loadAll(userId: String): List<VendorOverride> = runCatching {
        supabase.postgrest["overrides"]
            .select { filter { eq("user_id", userId) } }
            .decodeList<VendorOverrideRow>()
    }.getOrNull().orEmpty().map { it.toDomain() }

    /** Update the category (stored as the Budgets enum name). */
    suspend fun updateCategory(
        userId: String,
        id: String,
        categoryName: String,
    ): Result<Unit> = runCatching {
        supabase.postgrest["overrides"].update(mapOf("category_id" to categoryName)) {
            filter {
                eq("id", id)
                eq("user_id", userId)
            }
        }
        Unit
    }

    /** Update the vendor's display (proper) name. */
    suspend fun updateProperName(
        userId: String,
        id: String,
        properName: String,
    ): Result<Unit> = runCatching {
        supabase.postgrest["overrides"].update(mapOf("proper_name" to properName)) {
            filter {
                eq("id", id)
                eq("user_id", userId)
            }
        }
        Unit
    }

    suspend fun delete(userId: String, id: String): Result<Unit> = runCatching {
        supabase.postgrest["overrides"].delete {
            filter {
                eq("id", id)
                eq("user_id", userId)
            }
        }
        Unit
    }
}

private fun VendorOverrideRow.toDomain(): VendorOverride = VendorOverride(
    id = id,
    properName = properName,
    matchKey = matchKey,
    matchType = MatchType.fromDbValue(matchType),
    categoryName = categoryId.orEmpty(),
    updatedAt = updatedAt,
)

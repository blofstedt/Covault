package com.covault.app.data.repository

import com.covault.app.data.model.Settings
import com.covault.app.data.remote.dto.SettingsRow
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.postgrest
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Settings table CRUD. Direct port of the various settings-side
 * writes in `lib/hooks/useUserSettings.ts` and
 * `lib/hooks/useHouseholdLinking.ts`.
 */
@Singleton
class SettingsRepository @Inject constructor(
    private val supabase: SupabaseClient,
) {

    suspend fun loadSettings(userId: String): SettingsRow? = runCatching {
        supabase.postgrest["settings"]
            .select { filter { eq("user_id", userId) }; limit(1) }
            .decodeSingleOrNull<SettingsRow>()
    }.getOrNull()

    suspend fun upsertSettings(userId: String, update: SettingsUpdate): Result<Unit> = runCatching {
        val row = buildMap<String, Any?> {
            put("user_id", userId)
            update.monthlyIncome?.let { put("monthly_income", it) }
            update.theme?.let { put("theme_selected", it) }
            update.rolloverEnabled?.let { put("rollover_enabled", it) }
            update.useLeisureAsBuffer?.let { put("leisure_buffer_enabled", it) }
            update.showSavingsInsight?.let { put("show_savings_insight", it) }
            update.appNotificationsEnabled?.let { put("app_notifications_enabled", it) }
            update.smartNotificationsEnabled?.let { put("smart_notifications_enabled", it) }
            update.budgetingSolo?.let { put("budgeting_solo", it) }
        }
        supabase.postgrest["settings"].upsert(row) {
            filter { eq("user_id", userId) }
        }
    }

    suspend fun linkPartner(userId: String, partnerEmail: String): Result<Unit> = runCatching {
        // The React app's `handleLinkPartner` does a multi-step write:
        // 1. Look up the partner by email in auth.users via a SECURITY
        //    DEFINER function (`lookup_user_id_by_email`)
        // 2. Set `partner_id` on the caller's settings row
        // The function is defined in supabase/migrations/. We invoke
        // it via RPC; if the project doesn't have the function yet,
        // this returns failure and the UI surfaces the error.
        val partnerId = supabase.postgrest.rpc(
            function = "lookup_user_id_by_email",
            parameters = mapOf("email_input" to partnerEmail),
        ).decodeAsOrNull<String>() ?: error("Partner not found")
        supabase.postgrest["settings"].update(
            mapOf("partner_id" to partnerId, "partner_email" to partnerEmail, "budgeting_solo" to false)
        ) { filter { eq("user_id", userId) } }
    }

    suspend fun unlinkPartner(userId: String): Result<Unit> = runCatching {
        supabase.postgrest["settings"].update(
            mapOf("partner_id" to null, "partner_email" to null, "budgeting_solo" to true)
        ) { filter { eq("user_id", userId) } }
    }
}

/** Partial-update payload for [SettingsRepository.upsertSettings]. */
data class SettingsUpdate(
    val monthlyIncome: Double? = null,
    val theme: String? = null,
    val rolloverEnabled: Boolean? = null,
    val useLeisureAsBuffer: Boolean? = null,
    val showSavingsInsight: Boolean? = null,
    val appNotificationsEnabled: Boolean? = null,
    val smartNotificationsEnabled: Boolean? = null,
    val budgetingSolo: Boolean? = null,
)

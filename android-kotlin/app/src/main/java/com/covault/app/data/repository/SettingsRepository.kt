package com.covault.app.data.repository

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
        // Targeted UPDATE of only the changed columns. A full-row upsert
        // fails here: it re-serializes read-only/managed columns (link_code,
        // trial_*, subscription_status) and can violate constraints — which
        // is why "Save income" silently did nothing. The settings row always
        // exists (created at signup), so UPDATE is correct — same pattern as
        // [linkPartner].
        supabase.postgrest["settings"].update({
            update.monthlyIncome?.let { set("monthly_income", it) }
            update.theme?.let { set("theme_selected", it) }
            update.useLeisureAsBuffer?.let { set("leisure_buffer_enabled", it) }
            update.showSavingsInsight?.let { set("show_savings_insight", it) }
            update.appNotificationsEnabled?.let { set("app_notifications_enabled", it) }
            update.budgetingSolo?.let { set("budgeting_solo", it) }
        }) { filter { eq("user_id", userId) } }
    }

    suspend fun linkPartner(userId: String, partnerEmail: String): Result<Unit> = runCatching {
        val partnerId = supabase.postgrest.rpc(
            function = "lookup_user_id_by_email",
            parameters = kotlinx.serialization.json.JsonObject(mapOf(
                "email_input" to kotlinx.serialization.json.JsonPrimitive(partnerEmail),
            )),
        ).decodeAsOrNull<String>() ?: error("Partner not found")
        supabase.postgrest["settings"].update(
            { set("partner_id", partnerId); set("partner_email", partnerEmail); set("budgeting_solo", false) }
        ) { filter { eq("user_id", userId) } }
    }

    suspend fun unlinkPartner(userId: String): Result<Unit> = runCatching {
        supabase.postgrest["settings"].update(
            { setToNull("partner_id"); setToNull("partner_email"); set("budgeting_solo", true) }
        ) { filter { eq("user_id", userId) } }
    }
}

/** Partial-update payload for [SettingsRepository.upsertSettings]. */
data class SettingsUpdate(
    val monthlyIncome: Double? = null,
    val theme: String? = null,
    val useLeisureAsBuffer: Boolean? = null,
    val showSavingsInsight: Boolean? = null,
    val appNotificationsEnabled: Boolean? = null,
    val budgetingSolo: Boolean? = null,
)

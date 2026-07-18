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
        // Build a SettingsRow with the existing values; not all fields
        // are present in [update], so we read the current row first
        // and merge. For the common case (just changing income), this
        // still does a full upsert.
        val current = loadSettings(userId) ?: com.covault.app.data.remote.dto.SettingsRow(
            userId = userId, name = "", email = "",
        )
        val merged = current.copy(
            monthlyIncome = update.monthlyIncome ?: current.monthlyIncome,
            themeSelected = update.theme ?: current.themeSelected,
            rolloverEnabled = update.rolloverEnabled ?: current.rolloverEnabled,
            leisureBufferEnabled = update.useLeisureAsBuffer ?: current.leisureBufferEnabled,
            showSavingsInsight = update.showSavingsInsight ?: current.showSavingsInsight,
            appNotificationsEnabled = update.appNotificationsEnabled ?: current.appNotificationsEnabled,
            budgetingSolo = update.budgetingSolo ?: current.budgetingSolo,
        )
        supabase.postgrest["settings"].upsert(merged) {
            onConflict = "user_id"
        }
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
    val rolloverEnabled: Boolean? = null,
    val useLeisureAsBuffer: Boolean? = null,
    val showSavingsInsight: Boolean? = null,
    val appNotificationsEnabled: Boolean? = null,
    val smartNotificationsEnabled: Boolean? = null,
    val budgetingSolo: Boolean? = null,
)

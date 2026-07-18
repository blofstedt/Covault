package com.covault.app.data.remote.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// ============================================================================
// Supabase row DTOs. These mirror the column names returned by PostgREST for
// the live schema. The mappers in TransactionMappers convert these to the
// domain models. We keep DTOs separate from domain models so column renames
// or schema drift only touches the mapper, not the UI layer.
// ============================================================================

@Serializable
data class SettingsRow(
    @SerialName("user_id") val userId: String,
    val name: String,
    val email: String,
    @SerialName("partner_id") val partnerId: String? = null,
    @SerialName("partner_email") val partnerEmail: String? = null,
    @SerialName("partner_name") val partnerName: String? = null,
    @SerialName("budgeting_solo") val budgetingSolo: Boolean? = null,
    @SerialName("monthly_income") val monthlyIncome: Double? = null,
    @SerialName("rollover_enabled") val rolloverEnabled: Boolean? = null,
    @SerialName("leisure_buffer_enabled") val leisureBufferEnabled: Boolean? = null,
    @SerialName("show_savings_insight") val showSavingsInsight: Boolean? = null,
    @SerialName("app_notifications_enabled") val appNotificationsEnabled: Boolean? = null,
    @SerialName("theme_selected") val themeSelected: String? = null,
    @SerialName("trial_started_at") val trialStartedAt: String? = null,
    @SerialName("trial_ends_at") val trialEndsAt: String? = null,
    @SerialName("trial_consumed") val trialConsumed: Boolean? = null,
    @SerialName("subscription_status") val subscriptionStatus: String? = null,
    @SerialName("link_code") val linkCode: String? = null,
)

@Serializable
data class TransactionRow(
    val id: String,
    @SerialName("user_id") val userId: String,
    val vendor: String,
    val amount: Double,
    val date: String,         // Supabase returns DATE as "YYYY-MM-DD" (no time)
    @SerialName("is_projected") val isProjected: Boolean,
    val budget: String,       // public."Budgets" enum value
    val type: String,         // public."Type" enum: "Manual" | "Automatic"
    val recur: String,        // public."Recurrence" enum
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("caught_cleared") val caughtCleared: Boolean? = null,
    val source: String? = null,
    @SerialName("user_name") val userName: String? = null,
    @SerialName("is_income") val isIncome: Boolean? = null,
)

@Serializable
data class BudgetRow(
    @SerialName("user_uuid") val userUuid: String,
    val budget: String,       // public."Budgets" enum value
    val amount: Double,
    val visible: Boolean = true,
)

@Serializable
data class PendingTransactionRow(
    val id: String,
    @SerialName("user_id") val userId: String,
    @SerialName("app_package") val appPackage: String,
    @SerialName("app_name") val appName: String,
    @SerialName("notification_timestamp") val notificationTimestamp: Long,
    @SerialName("posted_at") val postedAt: String,
    @SerialName("extracted_vendor") val extractedVendor: String,
    @SerialName("extracted_amount") val extractedAmount: Double,
    @SerialName("extracted_timestamp") val extractedTimestamp: String,
    val confidence: Double,
    val status: String,
    @SerialName("rejection_reason") val rejectionReason: String? = null,
    @SerialName("created_at") val createdAt: String,
    @SerialName("reviewed_at") val reviewedAt: String? = null,
)

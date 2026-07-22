package com.covault.app.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// ============================================================================
// Domain models — 1:1 port of types.ts. These are the in-app representations
// the UI and ViewModels work with. The Supabase row DTOs (in remote/dto)
// convert to/from these via the TransactionMappers port.
// ============================================================================

@Serializable
data class User(
    val id: String,
    val name: String,
    val email: String,
    val partnerId: String? = null,
    val partnerEmail: String? = null,
    val partnerName: String? = null,
    val hasJointAccounts: Boolean = false,
    val budgetingSolo: Boolean = true,
    val monthlyIncome: Double = 0.0,
    val trialStartedAt: String? = null,
    val trialEndsAt: String? = null,
    val trialConsumed: Boolean = false,
    val subscriptionStatus: SubscriptionStatus = SubscriptionStatus.NONE,
)

@Serializable
enum class SubscriptionStatus { NONE, ACTIVE, EXPIRED }

@Serializable
data class BudgetCategory(
    val id: String,
    val name: String,
    val totalLimit: Double,
    val externalDeduction: Double? = null,
)

@Serializable
data class PendingTransaction(
    val id: String,
    val userId: String,
    val appPackage: String,
    val appName: String,
    val notificationTimestamp: Long,
    val postedAt: String,
    val extractedVendor: String,
    val extractedAmount: Double,
    val extractedTimestamp: String,
    val confidence: Double,
    val status: PendingStatus,
    val rejectionReason: String? = null,
    val createdAt: String,
    val reviewedAt: String? = null,
)

@Serializable
enum class PendingStatus { PENDING, APPROVED, REJECTED }

@Serializable
enum class Recurrence {
    @SerialName("One-time") ONE_TIME,
    @SerialName("Biweekly") BIWEEKLY,
    @SerialName("Monthly") MONTHLY;

    val dbValue: String get() = name.replace('_', '-')

    companion object {
        fun fromDbValue(value: String?): Recurrence = when (value) {
            "Biweekly" -> BIWEEKLY
            "Monthly" -> MONTHLY
            else -> ONE_TIME
        }
    }
}

@Serializable
enum class TransactionLabel { AUTOMATIC, MANUAL }

@Serializable
enum class TransactionSource { EXECUTOR, NOTIFICATION, MANUAL, IMPORT }

@Serializable
data class SoftDuplicateHint(
    val id: String,
    val vendor: String,
    val amount: Double,
    val date: String,
)

@Serializable
data class Transaction(
    val id: String,
    val userId: String,
    val vendor: String,
    val amount: Double,
    /** Local-calendar YYYY-MM-DD, optionally followed by ISO time. The UI
     *  slices to first 10 chars for display. */
    val date: String,
    val budgetId: String? = null,
    val recurrence: Recurrence = Recurrence.ONE_TIME,
    val label: TransactionLabel = TransactionLabel.MANUAL,
    val isProjected: Boolean = false,
    val isIncome: Boolean = false,
    val caughtCleared: Boolean = false,
    val userName: String? = null,
    val createdAt: String,
    val source: TransactionSource? = null,
    /** In-memory only, never persisted. */
    val softDuplicateOf: SoftDuplicateHint? = null,
)

@Serializable
data class Settings(
    val userId: String,
    val name: String,
    val email: String,
    val partnerId: String? = null,
    val partnerEmail: String? = null,
    val partnerName: String? = null,
    val hasJointAccounts: Boolean? = null,
    val budgetingSolo: Boolean? = null,
    val monthlyIncome: Double? = null,
    val useLeisureAsBuffer: Boolean = true,
    val showSavingsInsight: Boolean = true,
    val theme: String = "light",
)

@Serializable
data class AppStateSettings(
    val useLeisureAsBuffer: Boolean = true,
    val showSavingsInsight: Boolean = true,
    val theme: String = "light",
    val notificationsEnabled: Boolean = false,
    val hiddenCategories: List<String> = emptyList(),
    val appNotificationsEnabled: Boolean = false,
    val smartNotificationsEnabled: Boolean = true,
)

@Serializable
data class AppState(
    val user: User? = null,
    val budgets: List<BudgetCategory> = emptyList(),
    val transactions: List<Transaction> = emptyList(),
    val pendingTransactions: List<PendingTransaction> = emptyList(),
    val settings: AppStateSettings = AppStateSettings(),
)

package com.covault.app.data.repository

import com.covault.app.data.model.PendingTransaction
import com.covault.app.data.model.PendingStatus
import com.covault.app.data.model.SystemCategories
import com.covault.app.data.model.User
import com.covault.app.data.remote.dto.PendingTransactionRow
import com.covault.app.domain.DateUtils
import com.covault.app.notification.NotificationParser
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.postgrest.postgrest
import java.time.Instant
import java.time.ZoneId
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Notification-processing pipeline. Direct port of
 * `lib/notificationProcessor.ts`.
 *
 * Pipeline:
 *  1. Get the current authenticated user (skip if no session)
 *  2. Run the [NotificationParser] on the raw notification text
 *  3. Filter: stop phrases, non-financial patterns, missing amount
 *  4. Dedup: check the `pending_transactions` table for a row in
 *     the last 5 minutes with the same vendor + amount
 *  5. Insert into `pending_transactions` with confidence score
 *
 * The on-device AI model (HF transformers) is **not** ported. The
 * pipeline falls back to the deterministic parser for everything. A
 * confidence below 0.65 means "we're guessing" — Stage 7's job is
 * to either tighten the parser or wire the AI model.
 */
@Singleton
class NotificationRepository @Inject constructor(
    private val supabase: SupabaseClient,
    private val sessionStore: SessionStore,
) {

    suspend fun process(
        packageName: String,
        rawText: String,
        timestamp: Long,
    ): ProcessResult {
        val userId = currentUserId() ?: return ProcessResult.SkippedNoSession

        val parsed = NotificationParser.parse(rawText)
        if (parsed.rejectionReason != null) {
            return ProcessResult.Rejected(parsed.rejectionReason)
        }
        if (parsed.amount == null || parsed.vendorDisplay == null) {
            return ProcessResult.Rejected("missing_fields")
        }
        if (parsed.confidence < 0.5) {
            return ProcessResult.Rejected("low_confidence:${parsed.confidence}")
        }

        // ── Dedup: skip if a row in the last 5 min matches ──
        val fiveMinAgo = Instant.ofEpochMilli(timestamp - 5 * 60 * 1000).toString()
        val recent = runCatching {
            supabase.postgrest["pending_transactions"]
                .select {
                    filter {
                        eq("user_id", userId)
                        gte("created_at", fiveMinAgo)
                    }
                }
                .decodeList<PendingTransactionRow>()
        }.getOrNull().orEmpty()

        val isDup = recent.any { row ->
            row.extractedVendor.equals(parsed.vendorDisplay, ignoreCase = true) &&
                kotlin.math.abs(row.extractedAmount - parsed.amount) < 0.01
        }
        if (isDup) return ProcessResult.Duplicate

        // ── Insert ──
        val postedAt = Instant.ofEpochMilli(timestamp)
            .atZone(ZoneId.systemDefault())
            .toLocalDateTime()
            .format(java.time.format.DateTimeFormatter.ISO_LOCAL_DATE_TIME)
        val row = PendingTransactionRow(
            id = UUID.randomUUID().toString(),
            userId = userId,
            appPackage = packageName,
            appName = packageName.substringAfterLast('.'),
            notificationTimestamp = timestamp,
            postedAt = postedAt,
            extractedVendor = parsed.vendorDisplay,
            extractedAmount = if (parsed.isOutgoing) -kotlin.math.abs(parsed.amount) else kotlin.math.abs(parsed.amount),
            extractedTimestamp = postedAt,
            confidence = parsed.confidence,
            status = "pending",
            createdAt = Instant.now().toString(),
        )
        runCatching {
            supabase.postgrest["pending_transactions"].insert(row)
        }.onFailure { return ProcessResult.Failed(it.message ?: "insert_failed") }

        return ProcessResult.Stored(parsed)
    }

    private suspend fun currentUserId(): String? {
        // The Supabase client holds the current session in memory; this
        // doesn't go through SessionStore because the listener starts
        // at boot, before any Hilt-scoped coroutine has a chance to
        // run. Reading from the supabase client directly is the same
        // call the auth state uses.
        return runCatching { supabase.auth.currentSessionOrNull()?.user?.id }.getOrNull()
    }

    suspend fun approvePending(transactionId: String, budgetId: String?): Result<Unit> = runCatching {
        // Approve = move the pending row to the transactions table.
        // The React app's approve flow is a multi-step write: read the
        // pending row, build a Transaction, insert, then delete the
        // pending row. We do the same.
        val pending = supabase.postgrest["pending_transactions"]
            .select { filter { eq("id", transactionId) }; limit(1) }
            .decodeSingle<PendingTransactionRow>()
        val userId = currentUserId() ?: return@runCatching
        val resolvedBudgetId = budgetId
            ?: SystemCategories.idForName("Other")
            ?: SystemCategories.OTHER.id
        val tx = mapOf(
            "user_id" to userId,
            "vendor" to pending.extractedVendor,
            "amount" to pending.extractedAmount,
            "date" to DateUtils.toLocalIsoDay(java.time.LocalDate.now()),
            "is_projected" to false,
            "budget" to (SystemCategories.nameForId(resolvedBudgetId) ?: "Other"),
            "type" to "Automatic",
            "recur" to "One-time",
            "source" to "notification",
            "caught_cleared" to false,
        )
        supabase.postgrest["transactions"].insert(tx)
        supabase.postgrest["pending_transactions"].delete {
            filter { eq("id", transactionId) }
        }
    }

    suspend fun rejectPending(transactionId: String, reason: String): Result<Unit> = runCatching {
        supabase.postgrest["pending_transactions"].update(
            mapOf("status" to "rejected", "rejection_reason" to reason)
        ) { filter { eq("id", transactionId) } }
    }
}

sealed interface ProcessResult {
    data object SkippedNoSession : ProcessResult
    data class Rejected(val reason: String) : ProcessResult
    data object Duplicate : ProcessResult
    data class Failed(val message: String) : ProcessResult
    data class Stored(val parsed: NotificationParser.Parsed) : ProcessResult
}

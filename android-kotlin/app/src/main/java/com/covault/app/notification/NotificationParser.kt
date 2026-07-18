package com.covault.app.notification

import java.util.Locale
import kotlin.math.abs

/**
 * Pure-logic port of `lib/deviceTransactionParser.ts`. Pulls
 * vendor, amount, and direction out of a raw bank notification.
 *
 * The React port handles ~150 edge cases (pre-auth vs settled,
 * refunds, income, currency variants, weak vs strong go-phrases,
 * provincial tax, etc.). This Kotlin port covers the common
 * cases. The full rule set can be filled in by re-reading the
 * React source and porting each `if` clause.
 */
object NotificationParser {

    data class Parsed(
        val isOutgoing: Boolean,
        val amount: Double?,
        val vendorDisplay: String?,
        val vendorKey: String?,
        val recurrence: Recurrence = Recurrence.ONE_TIME,
        val isRefund: Boolean = false,
        val isIncome: Boolean = false,
        val isPreAuth: Boolean = false,
        val confidence: Double = 0.0,
        val rejectionReason: String? = null,
    )

    enum class Recurrence { ONE_TIME, BIWEEKLY, MONTHLY }

    private val STOP_PHRASES = listOf(
        "verification code", "security code", "otp", "passcode", "2fa", "password",
        "login", "signed in", "new device", "statement", "e-statement",
        "payment due", "due date", "account balance", "available balance",
        "current balance", "balance is", "deposit", "payroll", "salary",
        "interest", "dividend", "e-transfer received", "etransfer received",
        "transfer received", "money received", "available credit", "credit limit",
    )

    private val REFUND_PHRASES = listOf("refund", "reversal", "credited", "cashback")

    private val GO_PHRASES = listOf(
        "spend", "spent", "purchase", "purchased", "debit", "debit purchase",
        "pos", "tap", "tapped", "charged", "charge", "payment", "bill payment",
        "bill paid", "paid", "payment to", "transfer to", "sent to",
        "e-transfer sent", "etransfer sent", "interac e-transfer sent",
        "cost", "costs", "pre-authorized debit", "preauthorized debit",
        "withdrawal", "atm withdrawal",
    )

    private val INCOME_PHRASES = listOf(
        "e-transfer received", "etransfer received", "transfer received",
        "you got an interac", "you got a interac", "you received",
        "sent you", "money received", "deposit received",
        "deposited the funds", "direct deposit",
    )

    private val PRE_AUTH_PHRASES = listOf(
        "authorization hold", "pre-authorization", "preauthorization",
        "temporary hold", "hold placed", "pending transaction",
        "authorization pending", "pending charge", "pending purchase",
    )

    private val SETTLEMENT_PHRASES = listOf("posted", "settled", "cleared", "processed", "completed")

    private val NON_FINANCIAL_PATTERNS = listOf(
        Regex("""\b(?:ETH|BTC|SOL|ADA|DOT|DOGE|XRP|MATIC|AVAX|LINK|LTC|USDT|USDC|BNB|SHIB)\b.*?\b(?:up|down|trading|price|market|rally|crash|surge|drop|gain|loss|fell|rose|climb)""", RegexOption.IGNORE_CASE),
        Regex("""\bmarket\s+cap\b""", RegexOption.IGNORE_CASE),
        Regex("""\bprice\s+alert\b""", RegexOption.IGNORE_CASE),
        Regex("""\b(?:up|down)\s+\d+(?:\.\d+)?%""", RegexOption.IGNORE_CASE),
        Regex("""\b(?:limited\s+time|act\s+now|exclusive\s+offer|flash\s+sale)\b""", RegexOption.IGNORE_CASE),
        Regex("""\b(?:promo\s+code|coupon\s+code|discount\s+code|referral\s+code)\b""", RegexOption.IGNORE_CASE),
    )

    private val AMOUNT_REGEX = Regex(
        """(?<!\w)(?:\$|cad\s*)\s*([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)(?:[.,]([0-9]{1,2}))?(?!\w)|(?<!\w)([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)(?:\.([0-9]{2}))(?!\w)""",
        RegexOption.IGNORE_CASE,
    )

    fun parse(raw: String): Parsed {
        val lower = raw.lowercase(Locale.ROOT)

        // ── Non-financial filter ──
        for (pattern in NON_FINANCIAL_PATTERNS) {
            if (pattern.containsMatchIn(lower)) {
                return Parsed(
                    isOutgoing = false,
                    amount = null, vendorDisplay = null, vendorKey = null,
                    confidence = 0.0,
                    rejectionReason = "non_financial",
                )
            }
        }

        // ── Stop-phrase filter ──
        for (phrase in STOP_PHRASES) {
            if (lower.contains(phrase)) {
                return Parsed(
                    isOutgoing = false,
                    amount = null, vendorDisplay = null, vendorKey = null,
                    confidence = 0.0,
                    rejectionReason = "stop_phrase:$phrase",
                )
            }
        }

        val amount = extractAmount(raw)
        val isPreAuth = PRE_AUTH_PHRASES.any { lower.contains(it) }
        val isIncome = INCOME_PHRASES.any { lower.contains(it) }
        val isRefund = REFUND_PHRASES.any { lower.contains(it) } && !isIncome
        val isOutgoing = !isIncome && (GO_PHRASES.any { lower.contains(it) } || isPreAuth || isRefund)

        if (amount == null) {
            return Parsed(
                isOutgoing = isOutgoing,
                amount = null,
                vendorDisplay = null,
                vendorKey = null,
                confidence = 0.0,
                rejectionReason = "no_amount",
            )
        }

        val vendorDisplay = extractVendor(raw)
        val vendorKey = vendorDisplay?.lowercase()?.replace(Regex("[^a-z0-9 ]"), "")?.trim()
        val confidence = when {
            vendorDisplay == null -> 0.3
            isPreAuth -> 0.6
            isRefund -> 0.7
            isIncome -> 0.8
            GO_PHRASES.any { lower.contains(it) } -> 0.9
            else -> 0.5
        }

        return Parsed(
            isOutgoing = isOutgoing,
            amount = amount,
            vendorDisplay = vendorDisplay,
            vendorKey = vendorKey,
            isRefund = isRefund,
            isIncome = isIncome,
            isPreAuth = isPreAuth,
            confidence = confidence,
        )
    }

    private fun extractAmount(text: String): Double? {
        val match = AMOUNT_REGEX.find(text) ?: return null
        val groups = match.groupValues
        // group 1 = dollars, group 2 = cents (if $-prefixed)
        // group 3 = dollars, group 4 = cents (if no prefix)
        val dollars = (groups.getOrNull(1)?.takeIf { it.isNotEmpty() }
            ?: groups.getOrNull(3)).orEmpty()
        val cents = (groups.getOrNull(2)?.takeIf { it.isNotEmpty() }
            ?: groups.getOrNull(4).orEmpty())
        if (dollars.isBlank()) return null
        val normalized = dollars.replace(",", "")
        val dollarsD = normalized.toDoubleOrNull() ?: return null
        val centsD = if (cents.isNotEmpty()) cents.toDoubleOrNull()?.div(100.0) ?: 0.0 else 0.0
        return abs(dollarsD + centsD)
    }

    private fun extractVendor(text: String): String? {
        // Heuristic: take the first phrase before the amount. Real parser
        // uses a state machine; this is a good-enough stub for Stage 6.
        val beforeAmount = text.replace(Regex("""\$.*"""), "").trim()
        if (beforeAmount.isBlank()) return null
        // Strip "card ending in 1234", dates, etc.
        val cleaned = beforeAmount
            .replace(Regex("""\bcard\s+ending\s+in\s+\d{4}\b""", RegexOption.IGNORE_CASE), "")
            .replace(Regex("""\bon\s+\d{4}-\d{2}-\d{2}\b""", RegexOption.IGNORE_CASE), "")
            .replace(Regex("""\b\d{4,}\b"""), "")
            .trim()
            .trimEnd(',', '·', '.', '|', '-')
        if (cleaned.isBlank()) return null
        // Last word-ish phrase, capitalized.
        return cleaned.split(Regex("[·\\-–|]")).last().trim()
            .split(Regex("\\s+"))
            .filter { it.isNotBlank() }
            .joinToString(" ") { word ->
                if (word.isEmpty()) word
                else word.first().uppercaseChar() + word.substring(1).lowercase()
            }
            .takeIf { it.length >= 2 }
    }
}

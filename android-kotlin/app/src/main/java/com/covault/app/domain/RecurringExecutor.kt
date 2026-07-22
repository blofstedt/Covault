package com.covault.app.domain

import com.covault.app.data.model.Recurrence
import com.covault.app.data.model.Transaction
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/**
 * Pure-logic port of `lib/recurringExecutor.ts`. Computes which
 * recurring transactions are due as of [today] and would need to be
 * auto-inserted.
 *
 * Projections are display-time only: [com.covault.app.domain.DashboardTotals]
 * calls [computeFutureProjections] to fold upcoming recurring transactions
 * into the remaining-money math. Nothing persists projected rows to the DB.
 */
object RecurringExecutor {

    /** Safety cap on the number of projected rows per template. */
    private const val MAX_PROJECTED_PER_TEMPLATE = 200

    /**
     * Compute the projected transactions for *future* dates (the ones
     * that show up in the budget's "projected" bar). Direct port of
     * `lib/projectedTransactions.ts` (the `generateProjectedTransactions`
     * function). Returns up to 6 months ahead.
     */
    fun computeFutureProjections(
        transactions: List<Transaction>,
        today: LocalDate = LocalDate.now(),
        monthsAhead: Int = 6,
    ): List<Transaction> {
        val out = mutableListOf<Transaction>()
        for (template in transactions) {
            if (template.recurrence == Recurrence.ONE_TIME) continue
            val base = runCatching { DateUtils.parseLocalDate(template.date) }
                .getOrNull() ?: continue
            var current = base
            for (i in 0 until MAX_PROJECTED_PER_TEMPLATE) {
                current = stepForward(current, template.recurrence)
                if (current.isAfter(today.plusMonths(monthsAhead.toLong()))) break
                if (current.isAfter(today)) {
                    out.add(template.copy(
                        id = projectedId(template.id, current.toString()),
                        date = current.toString() + "T12:00:00.000Z",
                        isProjected = true,
                        createdAt = current.toString() + "T12:00:00.000Z",
                    ))
                }
            }
        }
        return out
    }

    // ------------------------------------------------------------------------

    private fun stepForward(d: LocalDate, recurrence: Recurrence): LocalDate = when (recurrence) {
        Recurrence.BIWEEKLY -> d.plus(2, ChronoUnit.WEEKS)
        Recurrence.MONTHLY -> d.plus(1, ChronoUnit.MONTHS)
        Recurrence.ONE_TIME -> d  // never reached; checked by callers
    }

    private fun projectedId(templateId: String, dueDate: String): String =
        "projected-$templateId-$dueDate"
}

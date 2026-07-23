package com.covault.app.domain

import com.covault.app.data.model.BudgetCategory
import com.covault.app.data.model.Recurrence
import com.covault.app.data.model.SystemCategories
import com.covault.app.data.model.Transaction
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/**
 * Pure-logic port of `lib/recurringExecutor.ts`. Computes which
 * recurring transactions are due as of [today] and would need to be
 * auto-inserted.
 *
 * The React app persists the executor's output to the `transactions`
 * table with `is_projected = true`. The Kotlin port returns the
 * computed list of due transactions; the caller ([RecurringRepository])
 * does the actual insert via supabase-kt.
 */
object RecurringExecutor {

    /** How many months back the executor is allowed to catch up. */
    const val MAX_BACKFILL_MONTHS = 2

    /** Safety cap on the number of projected rows per template. */
    private const val MAX_PROJECTED_PER_TEMPLATE = 200

    /**
     * For each recurring transaction in the user's history, compute the
     * list of due dates between its base date and [today] that haven't
     * yet been inserted as actual transactions.
     */
    fun computeDueProjections(
        transactions: List<Transaction>,
        today: LocalDate = LocalDate.now(),
    ): List<Transaction> {
        val out = mutableListOf<Transaction>()
        for (template in transactions) {
            if (template.recurrence == Recurrence.ONE_TIME) continue
            val dueDates = dueDatesUpTo(template, today)
            for (due in dueDates) {
                out.add(template.copy(
                    id = projectedId(template.id, due),
                    date = due + "T12:00:00.000Z",
                    isProjected = true,
                    createdAt = due + "T12:00:00.000Z",
                ))
            }
        }
        return out
    }

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

    private fun dueDatesUpTo(template: Transaction, today: LocalDate): List<String> {
        val base = runCatching { DateUtils.parseLocalDate(template.date) }
            .getOrNull() ?: return emptyList()
        if (base.isAfter(today)) return emptyList()

        val floor = today.minusMonths(MAX_BACKFILL_MONTHS.toLong()).withDayOfMonth(1)
        val effectiveStart = if (base.isAfter(floor)) base else floor

        val out = mutableListOf<String>()
        var current = base
        for (i in 0 until MAX_PROJECTED_PER_TEMPLATE) {
            current = stepForward(current, template.recurrence)
            if (current.isAfter(today)) break
            if (current.isBefore(effectiveStart)) continue
            out.add(DateUtils.toLocalIsoDay(current))
        }
        return out
    }

    private fun stepForward(d: LocalDate, recurrence: Recurrence): LocalDate = when (recurrence) {
        Recurrence.BIWEEKLY -> d.plus(2, ChronoUnit.WEEKS)
        Recurrence.MONTHLY -> d.plus(1, ChronoUnit.MONTHS)
        Recurrence.ONE_TIME -> d  // never reached; checked by callers
    }

    private fun projectedId(templateId: String, dueDate: String): String =
        "projected-$templateId-$dueDate"
}

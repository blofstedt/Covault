package com.covault.app.domain

import java.time.LocalDate

/**
 * Date helpers that stay in the user's local calendar.
 *
 * Java's `Instant.toString().substring(0, 10)` is a UTC date — it rolls
 * over to "tomorrow" after ~5-7 PM in US timezones. The React app's
 * `lib/dateUtils.ts` works around this; this Kotlin port preserves the
 * same semantics using `java.time.LocalDate` (which is timezone-free
 * and represents the wall-clock date the user sees).
 */
object DateUtils {

    /**
     * Parse an ISO date string (e.g. "2025-02-01" or "2025-02-01T00:00:00.000Z")
     * into a [LocalDate] in the user's local calendar.
     */
    fun parseLocalDate(dateStr: String): LocalDate {
        val ymd = dateStr.substring(0, 10)
        return LocalDate.parse(ymd)
    }

    /** Today in the user's local calendar, as `YYYY-MM-DD`. */
    fun getLocalToday(): String = toLocalIsoDay(LocalDate.now())

    /** `YYYY-MM` key for the local month of [dateStr]. */
    fun getLocalMonthKey(dateStr: String): String {
        val d = parseLocalDate(dateStr)
        return "%04d-%02d".format(d.year, d.monthValue)
    }

    /** Format a [LocalDate] as `YYYY-MM-DD` using its calendar fields. */
    fun toLocalIsoDay(d: LocalDate): String = "%04d-%02d-%02d".format(
        d.year, d.monthValue, d.dayOfMonth,
    )
}

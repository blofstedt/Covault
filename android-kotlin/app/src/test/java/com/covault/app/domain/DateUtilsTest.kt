package com.covault.app.domain

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate

class DateUtilsTest {

    @Test
    fun `parseLocalDate strips time and parses YYYY-MM-DD`() {
        assertEquals(LocalDate.of(2025, 2, 1), DateUtils.parseLocalDate("2025-02-01"))
        assertEquals(LocalDate.of(2025, 2, 1), DateUtils.parseLocalDate("2025-02-01T00:00:00.000Z"))
        assertEquals(LocalDate.of(2025, 12, 31), DateUtils.parseLocalDate("2025-12-31T23:59:59.999Z"))
    }

    @Test
    fun `getLocalMonthKey returns YYYY-MM`() {
        assertEquals("2025-02", DateUtils.getLocalMonthKey("2025-02-15"))
        assertEquals("2025-12", DateUtils.getLocalMonthKey("2025-12-31"))
        assertEquals("2024-01", DateUtils.getLocalMonthKey("2024-01-01T00:00:00.000Z"))
    }

    @Test
    fun `toLocalIsoDay formats with zero padding`() {
        assertEquals("2025-02-01", DateUtils.toLocalIsoDay(LocalDate.of(2025, 2, 1)))
        assertEquals("2025-12-31", DateUtils.toLocalIsoDay(LocalDate.of(2025, 12, 31)))
        assertEquals("2000-01-01", DateUtils.toLocalIsoDay(LocalDate.of(2000, 1, 1)))
    }
}

package com.covault.app

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Stage 1 smoke test. Verifies the JVM unit test runner is wired correctly
 * (no Android instrumentation needed for this one). Real test coverage for
 * the data layer starts in Stage 2.
 */
class Stage1SmokeTest {
    @Test
    fun arithmetic_works() {
        assertEquals(4, 2 + 2)
    }
}

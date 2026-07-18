package com.covault.app.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FormatVendorNameTest {

    // --- formatVendorName --------------------------------------------------

    @Test
    fun `formatVendorName title cases simple words`() {
        assertEquals("Amazon", FormatVendorName.formatVendorName("AMAZON"))
        assertEquals("Amazon", FormatVendorName.formatVendorName("amazon"))
        assertEquals("Mcdonalds", FormatVendorName.formatVendorName("mCdOnAlDs"))
    }

    @Test
    fun `formatVendorName handles multi-word vendors`() {
        assertEquals("Shoppers Drug Mart", FormatVendorName.formatVendorName("shoppers drug mart"))
        assertEquals("Public Mobile", FormatVendorName.formatVendorName("PUBLIC MOBILE"))
    }

    @Test
    fun `formatVendorName handles empty and whitespace`() {
        assertEquals("", FormatVendorName.formatVendorName(""))
        assertEquals("", FormatVendorName.formatVendorName("   "))
    }

    // --- normalizeVendorForDedup -------------------------------------------

    @Test
    fun `normalizeVendorForDedup strips parenthetical suffixes`() {
        assertEquals("fizz", FormatVendorName.normalizeVendorForDedup("Fizz (Tx. Incl.)"))
        assertEquals("amazon", FormatVendorName.normalizeVendorForDedup("Amazon (Auto)"))
        assertEquals("amazon", FormatVendorName.normalizeVendorForDedup("Amazon (Online)"))
    }

    @Test
    fun `normalizeVendorForDedup strips trailing transaction refs`() {
        assertEquals("amazon", FormatVendorName.normalizeVendorForDedup("Amazon REF #1234"))
        assertEquals("amazon", FormatVendorName.normalizeVendorForDedup("Amazon TXN 5678"))
    }

    @Test
    fun `normalizeVendorForDedup strips trailing store numbers`() {
        assertEquals("shoppers drug mart", FormatVendorName.normalizeVendorForDedup("Shoppers Drug Mart #23"))
        assertEquals("amazon", FormatVendorName.normalizeVendorForDedup("Amazon STR 567"))
    }

    @Test
    fun `normalizeVendorForDedup strips trailing province codes`() {
        assertEquals("tim hortons", FormatVendorName.normalizeVendorForDedup("Tim Hortons ON"))
        assertEquals("amazon", FormatVendorName.normalizeVendorForDedup("Amazon CA"))
    }

    @Test
    fun `normalizeVendorForDedup collapses whitespace and strips non-alphanumeric`() {
        assertEquals("a b c", FormatVendorName.normalizeVendorForDedup("A   B   C!!!"))
    }

    @Test
    fun `normalizeVendorForDedup handles null and empty`() {
        assertEquals("", FormatVendorName.normalizeVendorForDedup(null))
        assertEquals("", FormatVendorName.normalizeVendorForDedup(""))
    }

    // --- fuzzyVendorMatch ---------------------------------------------------

    @Test
    fun `fuzzyVendorMatch returns true for identical normalized`() {
        assertTrue(FormatVendorName.fuzzyVendorMatch("Amazon", "amazon"))
        assertTrue(FormatVendorName.fuzzyVendorMatch("AMAZON", "amazon"))
    }

    @Test
    fun `fuzzyVendorMatch returns true for substring containment`() {
        assertTrue(FormatVendorName.fuzzyVendorMatch("Public Mobile", "Pub Mobile"))
        assertTrue(FormatVendorName.fuzzyVendorMatch("Tim Hortons", "Tim Hortons Toronto"))
    }

    @Test
    fun `fuzzyVendorMatch returns true for significant-token overlap`() {
        assertTrue(FormatVendorName.fuzzyVendorMatch("Shoppers Drug Mart #23", "Shoppers Drug Mart"))
    }

    @Test
    fun `fuzzyVendorMatch returns true for jaccard at threshold`() {
        // 1 shared token out of 2 distinct → 0.5, exactly threshold
        assertTrue(FormatVendorName.fuzzyVendorMatch("Amazon Prime", "Prime Video"))
    }

    @Test
    fun `fuzzyVendorMatch returns false for completely different vendors`() {
        assertFalse(FormatVendorName.fuzzyVendorMatch("Amazon", "Netflix"))
        assertFalse(FormatVendorName.fuzzyVendorMatch("Whole Foods", "Uber"))
    }

    @Test
    fun `fuzzyVendorMatch returns false for empty inputs`() {
        assertFalse(FormatVendorName.fuzzyVendorMatch("", "Amazon"))
        assertFalse(FormatVendorName.fuzzyVendorMatch("Amazon", ""))
    }
}

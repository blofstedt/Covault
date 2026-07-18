package com.covault.app.notification

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationParserTest {

    @Test
    fun `simple spend notification is parsed`() {
        val r = NotificationParser.parse("TD Visa - Purchase $49.99 at Amazon")
        assertNotNull(r.amount)
        assertEquals(49.99, r.amount!!, 0.01)
        assertTrue(r.isOutgoing)
        assertTrue(r.confidence > 0.7)
    }

    @Test
    fun `Celsius-prefixed amount is parsed`() {
        val r = NotificationParser.parse("You spent $12.50 at Starbucks")
        assertEquals(12.50, r.amount!!, 0.01)
    }

    @Test
    fun `amount with comma thousand separator is parsed`() {
        val r = NotificationParser.parse("Charged \$1,234.56 to your card")
        assertEquals(1234.56, r.amount!!, 0.01)
    }

    @Test
    fun `refund phrase flips direction to incoming`() {
        val r = NotificationParser.parse("Refund of $25.00 processed for your order")
        assertTrue(r.isRefund)
        assertTrue(!r.isOutgoing)
    }

    @Test
    fun `income phrases mark isIncome`() {
        val r = NotificationParser.parse("You received an Interac e-Transfer of $500")
        assertTrue(r.isIncome)
        assertTrue(!r.isOutgoing)
    }

    @Test
    fun `pre-auth phrase lowers confidence and marks isPreAuth`() {
        val r = NotificationParser.parse("Authorization hold of $30.00 at Petro-Canada")
        assertTrue(r.isPreAuth)
        assertTrue(r.confidence < 0.7)
    }

    @Test
    fun `OTP notification is rejected`() {
        val r = NotificationParser.parse("Your verification code is 482910")
        assertEquals("non_financial", r.rejectionReason)
    }

    @Test
    fun `balance check notification is rejected`() {
        val r = NotificationParser.parse("Your account balance is $5,432.10")
        assertEquals("stop_phrase:account balance", r.rejectionReason)
    }

    @Test
    fun `crypto price alert is rejected`() {
        val r = NotificationParser.parse("BTC is up 5.06% in the last 24 hours")
        assertEquals("non_financial", r.rejectionReason)
    }

    @Test
    fun `no amount means missing_fields rejection`() {
        val r = NotificationParser.parse("Hello, this is a test notification with no number")
        assertEquals("missing_fields", r.rejectionReason)
    }

    @Test
    fun `vendor display is extracted`() {
        val r = NotificationParser.parse("Charge at Whole Foods Market $87.32")
        assertNotNull(r.vendorDisplay)
        assertTrue(r.vendorDisplay!!.contains("Whole"))
    }
}

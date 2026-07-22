package com.covault.app.data

import com.covault.app.data.model.SystemCategories
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Regression tests for the idForName case bug: the lookup map must be
 * keyed lowercase because idForName lowercases its argument. This feeds
 * budget + transaction ID resolution everywhere (TransactionMappers,
 * UserDataRepository, NotificationRepository).
 */
class SystemCategoriesTest {

    @Test
    fun idForName_resolvesOriginalCase() {
        assertEquals(SystemCategories.GROCERIES.id, SystemCategories.idForName("Groceries"))
        assertEquals(SystemCategories.HOUSING.id, SystemCategories.idForName("Housing"))
    }

    @Test
    fun idForName_resolvesLowercaseAndWhitespace() {
        assertEquals(SystemCategories.LEISURE.id, SystemCategories.idForName("leisure"))
        assertEquals(SystemCategories.OTHER.id, SystemCategories.idForName("  other  "))
    }

    @Test
    fun idForName_allSevenRoundTripThroughNameForId() {
        SystemCategories.ALL.forEach { cat ->
            val id = SystemCategories.idForName(cat.name)
            assertEquals(cat.id, id)
            assertEquals(cat.name, SystemCategories.nameForId(id!!))
        }
    }

    @Test
    fun idForName_unknownReturnsNull() {
        assertNull(SystemCategories.idForName("Custom Category"))
    }
}

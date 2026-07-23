package com.covault.app.data.model

/**
 * System-defined budget categories. These are the only budget_id values
 * the DB enum (`public."Budgets"`) accepts. Custom user categories are
 * planned for a later stage — the React app currently treats everything
 * as one of these seven.
 *
 * Direct port of constants.ts. UUIDs match the React app so the same
 * budget_id round-trips through both clients.
 */
object SystemCategories {
    val HOUSING = BudgetCategory("11111111-1111-1111-1111-111111111111", "Housing", 500.0)
    val GROCERIES = BudgetCategory("22222222-2222-2222-2222-222222222222", "Groceries", 500.0)
    val TRANSPORT = BudgetCategory("33333333-3333-3333-3333-333333333333", "Transport", 500.0)
    val UTILITIES = BudgetCategory("44444444-4444-4444-4444-444444444444", "Utilities", 500.0)
    val LEISURE = BudgetCategory("55555555-5555-5555-5555-555555555555", "Leisure", 500.0)
    val SERVICES = BudgetCategory("77777777-7777-7777-7777-777777777777", "Services", 500.0)
    val OTHER = BudgetCategory("66666666-6666-6666-6666-666666666666", "Other", 500.0)

    val ALL: List<BudgetCategory> = listOf(
        HOUSING, GROCERIES, TRANSPORT, UTILITIES, LEISURE, SERVICES, OTHER,
    )

    /** Lookup table from the `Budgets` enum string to the system UUID. */
    private val idByName: Map<String, String> = ALL.associate { it.name to it.id }

    fun idForName(name: String): String? = idByName[name.trim().lowercase()]

    fun nameForId(id: String): String? = ALL.firstOrNull { it.id == id }?.name

    fun isValidEnumValue(name: String): Boolean = name in setOf(
        "Housing", "Groceries", "Leisure", "Utilities",
        "Transport", "Services", "Other",
    )
}

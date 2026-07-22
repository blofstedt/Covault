package com.covault.app.widget

import android.content.Context
import android.content.SharedPreferences
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.encodeToString

@Serializable
data class WidgetBudgetData(
    val name: String,
    val spent: Double,
    val limit: Double
)

@Serializable
data class WidgetData(
    val remainingBalance: Double = 0.0,
    val monthlyIncome: Double = 0.0,
    val budgets: List<WidgetBudgetData> = emptyList(),
    val updatedAt: Long = 0
)

object WidgetDataStore {
    private const val PREFS_NAME = "covault_widget_data"
    private const val KEY_DATA = "widget_data"
    private val json = Json { ignoreUnknownKeys = true }

    fun save(context: Context, data: WidgetData) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_DATA, json.encodeToString(data))
            .apply()
    }

    fun load(context: Context): WidgetData {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_DATA, null) ?: return WidgetData()
        return try {
            json.decodeFromString(raw)
        } catch (e: Exception) {
            WidgetData()
        }
    }

    fun clear(context: Context) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .remove(KEY_DATA)
            .apply()
    }
}
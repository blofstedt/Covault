package com.covault.app.data.repository

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private val Context.themeDataStore: DataStore<Preferences> by preferencesDataStore(name = "covault_theme")

/**
 * Persists the in-app theme choice (system / light / dark) via DataStore.
 * Local-only — theme is a device preference, not synced to Supabase.
 */
@Singleton
class ThemePreference @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    val themeMode: Flow<String> = context.themeDataStore.data.map { it[KEY] ?: MODE_SYSTEM }

    suspend fun set(mode: String) {
        context.themeDataStore.edit { it[KEY] = mode }
    }

    companion object {
        const val MODE_SYSTEM = "system"
        const val MODE_LIGHT = "light"
        const val MODE_DARK = "dark"
        private val KEY = stringPreferencesKey("theme_mode")
    }
}

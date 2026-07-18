package com.covault.app.data.repository

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.status.SessionStatus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import javax.inject.Inject
import javax.inject.Singleton

private val Context.dataStore by preferencesDataStore(name = "covault_session")
private val SESSION_START_KEY = longPreferencesKey("session_start_ms")

/**
 * Tracks whether the user is currently authenticated and the time their
 * session began (used for the 14-day expiry check, matching the React
 * `useAuthState` behavior).
 *
 * The data store is the source of truth for the expiry timestamp;
 * the in-memory [sessionState] is the source of truth for the *current*
 * session, fed by `supabase.auth.sessionStatus`.
 */
@Singleton
class SessionStore @Inject constructor(
    @ApplicationContext private val context: Context,
    private val supabase: SupabaseClient,
) {
    private val scope = CoroutineScope(SupervisorJob())

    private val _sessionState = MutableStateFlow<SessionStatus>(SessionStatus.Initializing)
    val sessionState: StateFlow<SessionStatus> = _sessionState

    init {
        // Mirror supabase-kt's auth state into our StateFlow so ViewModels
        // can collectSessionStatus() reactively.
        scope.launch {
            supabase.auth.sessionStatus.collect { status ->
                _sessionState.value = status
                if (status is SessionStatus.Authenticated) {
                    markSessionStart()
                }
            }
        }
    }

    /**
     * True if the user has been signed in for less than [SESSION_DURATION_DAYS].
     * Mirrors `isSessionValid` in `lib/useAuthState.ts`. If no timestamp
     * is stored yet, the session is assumed valid and we stamp it now.
     */
    suspend fun isSessionValid(): Boolean {
        val start = context.dataStore.data
            .map { it[SESSION_START_KEY] }
            .first()
        val now = System.currentTimeMillis()
        if (start == null) {
            markSessionStart()
            return true
        }
        val days = (now - start).toDouble() / (1000.0 * 60.0 * 60.0 * 24.0)
        return days < SESSION_DURATION_DAYS
    }

    private suspend fun markSessionStart() {
        context.dataStore.edit { it[SESSION_START_KEY] = System.currentTimeMillis() }
    }

    suspend fun clear() {
        context.dataStore.edit { it.remove(SESSION_START_KEY) }
    }

    companion object {
        const val SESSION_DURATION_DAYS = 14
    }
}

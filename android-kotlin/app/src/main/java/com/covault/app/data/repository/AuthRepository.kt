package com.covault.app.data.repository

import com.covault.app.data.model.User
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.SignOutScope
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.Google
import io.github.jan.supabase.auth.status.SessionStatus
import io.github.jan.supabase.auth.user.UserSession
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.jsonPrimitive
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Auth state exposed to the UI. The 4-way match against the React app's
 * `AuthStatus` union: `loading | unauthenticated | onboarding | authenticated`.
 */
sealed interface AuthState {
    data object Loading : AuthState
    data object Unauthenticated : AuthState
    data object Onboarding : AuthState
    data class Authenticated(val user: User) : AuthState
}

/**
 * Auth flow entry point. Wraps the supabase-kt client with Covault-specific
 * semantics (the 14-day expiry check, the `mapUser` helper that fills in
 * defaults from the auth session before the DB row loads).
 *
 * Direct port of `lib/hooks/useAuthState.ts` + the `handleGoogleLogin`
 * logic from `components/Auth.tsx`. The session-status observation and
 * the deep-link callback are handled inside the supabase-kt client; this
 * repository just translates the result into our domain types.
 */
@Singleton
class AuthRepository @Inject constructor(
    private val supabase: SupabaseClient,
    private val sessionStore: SessionStore,
) {

    /**
     * Observes the live auth state. Emits:
     *  - [AuthState.Loading] on first observation
     *  - [AuthState.Authenticated] with a `User` once signed in
     *  - [AuthState.Onboarding] if the user has a session but no settings row
     *    (i.e. just signed up via Google and hasn't completed onboarding yet)
     *  - [AuthState.Unauthenticated] otherwise
     *
     * Note: "needs onboarding" detection requires a settings row query, which
     * is wired in Stage 4. For now we treat any authenticated session as
     * `Authenticated` and let the navigation layer route to the dashboard
     * skeleton; the dashboard itself will surface a "complete onboarding"
     * affordance if it finds the settings row missing.
     */
    val authState: Flow<AuthState> = flow {
        sessionStore.sessionState.collect { status ->
            val next = when (status) {
                is SessionStatus.Initializing -> AuthState.Loading
                is SessionStatus.NotAuthenticated -> AuthState.Unauthenticated
                is SessionStatus.Authenticated -> {
                    val session = status.session
                    if (!sessionStore.isSessionValid()) {
                        signOut()
                        AuthState.Unauthenticated
                    } else {
                        AuthState.Authenticated(mapUser(session))
                    }
                }
                is SessionStatus.RefreshFailure -> AuthState.Unauthenticated
            }
            emit(next)
        }
    }

    /**
     * Begin the Google OAuth flow. Opens a Custom Tab, Supabase handles the
     * rest. The deep link callback is caught by `MainActivity` calling
     * `supabase.handleDeeplinks(intent)`.
     */
    suspend fun signInWithGoogle(): Result<Unit> = runCatching {
        // Redirect MUST include the /callback path: it has to match both the
        // manifest intent-filter (scheme=com.covault.app host=auth path=/callback)
        // AND the redirect URL whitelisted in the Supabase dashboard. The React
        // app used this exact URL; leaving it off (the supabase-kt default of
        // scheme://host) lands on an unhandled page → the "404 on sign in".
        supabase.auth.signInWith(Google, redirectUrl = "com.covault.app://auth/callback")
        // Note: signInWith throws if it can't open the browser. The actual
        // sign-in completes async via the deep link; the session flow we
        // observe via [authState] is what the UI listens to.
    }

    suspend fun signOut() {
        runCatching { supabase.auth.signOut(SignOutScope.LOCAL) }
        sessionStore.clear()
    }

    /**
     * The current session's user, if any — available even before the settings
     * row loads (e.g. during onboarding). Used to persist onboarding choices.
     */
    fun currentUser(): User? =
        supabase.auth.currentSessionOrNull()?.let { mapUser(it) }

    /**
     * Map a supabase-kt session into our domain [User]. Mirrors the
     * `mapUser` helper in `lib/hooks/useAuthState.ts`. Fields like
     * `hasJointAccounts`, `budgetingSolo`, `monthlyIncome` come from the
     * `settings` table; we leave them at their defaults here and let
     * Stage 4's `UserRepository` overwrite them once the row loads.
     */
    private fun mapUser(session: UserSession): User {
        val supabaseUser = session.user ?: return User(id = "anonymous", name = "User", email = "")
        val name = supabaseUser.userMetadata
            ?.get("full_name")
            ?.jsonPrimitive
            ?.content
            ?.takeIf { it.isNotBlank() }
            ?: supabaseUser.email?.substringBefore("@")
            ?: "User"
        return User(
            id = supabaseUser.id,
            name = name,
            email = supabaseUser.email.orEmpty(),
            hasJointAccounts = false,
            budgetingSolo = true,
            monthlyIncome = 0.0,
        )
    }
}

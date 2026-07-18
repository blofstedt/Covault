package com.covault.app.data.remote

import com.covault.app.BuildConfig
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.realtime.Realtime
import io.github.jan.supabase.storage.Storage

/**
 * Single source of truth for the Supabase client. All repositories and
 * DAOs receive this through Hilt ([com.covault.app.di.SupabaseModule]).
 *
 * The URL and anon key come from `BuildConfig` (populated at build time
 * from `local.properties`). If `SUPABASE_ANON_KEY` is empty, the client
 * is intentionally NOT created — repositories that depend on it will
 * fail loudly at construction time, which is the desired behavior: we
 * never want a "stub" client in production that silently swallows calls.
 */
object SupabaseClientProvider {

    fun build(): SupabaseClient {
        val url = BuildConfig.SUPABASE_URL
        val key = BuildConfig.SUPABASE_ANON_KEY

        check(url.isNotBlank()) { "BuildConfig.SUPABASE_URL is blank" }
        check(key.isNotBlank()) {
            "BuildConfig.SUPABASE_ANON_KEY is blank. " +
                "Add SUPABASE_ANON_KEY=... to android-kotlin/local.properties and rebuild."
        }

        return createSupabaseClient(
            supabaseUrl = url,
            supabaseKey = key,
        ) {
            install(Auth) {
                // We use Custom Tabs + deep link for OAuth on Android,
                // so we keep PKCE enabled and let supabase-kt handle
                // the local session storage (DataStore-backed).
                alwaysAutoRefresh = true
                autoClearStorage = false
            }
            install(Postgrest)
            install(Realtime)
            install(Storage)
        }
    }
}

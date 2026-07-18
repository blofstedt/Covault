package com.covault.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import com.covault.app.ui.CovaultNavHost
import com.covault.app.ui.MainViewModel
import com.covault.app.ui.theme.CovaultTheme
import dagger.hilt.android.AndroidEntryPoint
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.handleDeeplinks
import javax.inject.Inject

/**
 * Single-activity host. Wires the navigation graph to the auth state
 * observed in [MainViewModel], and forwards incoming OAuth deep links
 * to the supabase-kt client so the auth flow can complete.
 */
@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject lateinit var supabase: SupabaseClient

    private val mainViewModel: MainViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        handleAuthDeepLink(intent)
        setContent {
            CovaultTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    CovaultNavHost(mainViewModel = mainViewModel)
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // Single-task launch mode means a fresh OAuth callback after the
        // app is already running lands here. supabase-kt's
        // handleDeeplinks() will pick up the new session and the
        // authState flow will emit, which the nav graph listens to.
        setIntent(intent)
        handleAuthDeepLink(intent)
    }

    private fun handleAuthDeepLink(intent: Intent?) {
        intent ?: return
        // The `data` field carries the deep link. supabase-kt's
        // handleDeeplinks() parses the OAuth code, exchanges it for a
        // session, and updates the underlying AuthState flow that
        // SessionStore mirrors into its own StateFlow.
        runCatching {
            supabase.handleDeeplinks(intent, onSessionSuccess = {})
        }
    }
}

package com.covault.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.covault.app.data.repository.ThemePreference
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
        handleWidgetSync(intent)
        setContent {
            val themeMode by mainViewModel.themeMode.collectAsStateWithLifecycle()
            val darkTheme = when (themeMode) {
                ThemePreference.MODE_DARK -> true
                ThemePreference.MODE_LIGHT -> false
                else -> isSystemInDarkTheme()
            }
            // dynamicColor off so the toggle deterministically controls the
            // brand light/dark scheme (matches the React app's fixed theme).
            CovaultTheme(darkTheme = darkTheme, dynamicColor = false) {
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
        setIntent(intent)
        handleAuthDeepLink(intent)
        handleWidgetSync(intent)
    }

    private fun handleAuthDeepLink(intent: Intent?) {
        intent ?: return
        runCatching {
            supabase.handleDeeplinks(intent, onSessionSuccess = {})
        }
    }

    /**
     * Handles widget refresh requests. When the user taps the refresh
     * button on the home-screen widget, it broadcasts a SYNC_WIDGET
     * intent that lands here. We trigger a data refresh so the widget
     * gets updated with the latest numbers.
     */
    private fun handleWidgetSync(intent: Intent?) {
        if (intent?.action == "com.covault.app.SYNC_WIDGET") {
            // The ViewModel will refresh data and update the widget
            // automatically via WidgetUpdater. We just need to make
            // sure the app is running (which it is, since this activity
            // received the intent).
        }
    }
}

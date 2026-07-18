package com.covault.app.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.covault.app.data.repository.AuthState
import com.covault.app.ui.auth.AuthScreen
import com.covault.app.ui.dashboard.DashboardScreen
import com.covault.app.ui.onboarding.OnboardingScreen
import com.covault.app.ui.splash.SplashScreen

/**
 * Top-level navigation routes. The graph is intentionally simple: a
 * single splash gate, then a switch between Auth, Onboarding, and
 * Dashboard based on the live [AuthState]. Stage 4 will introduce a
 * nested graph for the dashboard's bottom-tab destinations
 * (Dashboard / Transactions / Settings / Insights).
 */
object Routes {
    const val SPLASH = "splash"
    const val AUTH = "auth"
    const val ONBOARDING = "onboarding"
    const val DASHBOARD = "dashboard"
}

/**
 * The single root navigation graph. Owns the [NavHostController] and
 * observes [com.covault.app.ui.MainViewModel.authState] to drive
 * top-level route changes.
 */
@Composable
fun CovaultNavHost(
    mainViewModel: MainViewModel,
) {
    val navController = rememberNavController()
    val authState by mainViewModel.authState.collectAsStateWithLifecycle()

    // Whenever the auth state transitions, navigate to the matching
    // route. The `popUpTo` keeps the back stack clean so a sign-out
    // can't back-button the user into the dashboard.
    LaunchedEffect(authState) {
        val target = when (authState) {
            is AuthState.Loading -> Routes.SPLASH
            is AuthState.Unauthenticated -> Routes.AUTH
            is AuthState.Onboarding -> Routes.ONBOARDING
            is AuthState.Authenticated -> {
                // First-time sign-in vs returning user — Stage 3 doesn't
                // distinguish; Stage 4 routes fresh users to ONBOARDING
                // and returning users directly to DASHBOARD.
                Routes.DASHBOARD
            }
        }
        navController.navigate(target) {
            popUpTo(0) { inclusive = true }
            launchSingleTop = true
        }
    }

    NavHost(
        navController = navController,
        startDestination = Routes.SPLASH,
    ) {
        composable(Routes.SPLASH) { SplashScreen() }
        composable(Routes.AUTH) {
            AuthScreen(onAuthSuccess = { /* state observer handles nav */ })
        }
        composable(Routes.ONBOARDING) {
            OnboardingScreen(onComplete = { /* state observer handles nav */ })
        }
        composable(Routes.DASHBOARD) {
            DashboardScreen()
        }
    }
}

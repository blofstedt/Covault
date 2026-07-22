package com.covault.app.ui

import androidx.lifecycle.ViewModel
import com.covault.app.data.repository.AuthRepository
import com.covault.app.data.repository.AuthState
import com.covault.app.data.repository.ThemePreference
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import androidx.lifecycle.viewModelScope
import javax.inject.Inject

/**
 * Top-level ViewModel that exposes the auth state to the navigation
 * graph. Keeps the navigation logic in one place so the screens
 * themselves can be presentational.
 */
@HiltViewModel
class MainViewModel @Inject constructor(
    authRepository: AuthRepository,
    themePreference: ThemePreference,
) : ViewModel() {

    val authState: StateFlow<AuthState> = authRepository.authState
        .stateIn(viewModelScope, SharingStarted.Eagerly, AuthState.Loading)

    /** Persisted theme choice (system / light / dark) driving [CovaultTheme]. */
    val themeMode: StateFlow<String> = themePreference.themeMode
        .stateIn(viewModelScope, SharingStarted.Eagerly, ThemePreference.MODE_SYSTEM)
}

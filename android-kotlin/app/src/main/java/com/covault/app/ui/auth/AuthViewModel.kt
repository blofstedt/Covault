package com.covault.app.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.covault.app.data.repository.AuthRepository
import com.covault.app.data.repository.AuthState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Drives the [AuthScreen] and reports auth-state transitions to the
 * [com.covault.app.ui.MainViewModel] for top-level navigation.
 *
 * Single source of truth for the auth state across the app: both the
 * login screen and the onboarding flow collect `authState` from here.
 */
@HiltViewModel
class AuthViewModel @Inject constructor(
    private val authRepository: AuthRepository,
) : ViewModel() {

    val authState: StateFlow<AuthState> = authRepository.authState
        .stateIn(viewModelScope, SharingStarted.Eagerly, AuthState.Loading)

    private val _isLoggingIn = MutableStateFlow(false)
    val isLoggingIn: StateFlow<Boolean> = _isLoggingIn

    private val _authError = MutableStateFlow<String?>(null)
    val authError: StateFlow<String?> = _authError

    fun signInWithGoogle() {
        if (_isLoggingIn.value) return
        _isLoggingIn.value = true
        _authError.value = null
        viewModelScope.launch {
            authRepository.signInWithGoogle()
                .onFailure { e ->
                    _authError.value = e.message
                        ?: "An unexpected error occurred during sign in."
                }
            _isLoggingIn.value = false
        }
    }

    fun dismissError() {
        _authError.value = null
    }
}

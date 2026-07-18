package com.covault.app.ui.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.covault.app.data.model.User
import com.covault.app.data.repository.AuthRepository
import com.covault.app.data.repository.AuthState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

/**
 * Skeleton ViewModel for the dashboard. Stage 4 will replace this with
 * the real [TransactionRepository]-backed `useUserData` / `useDashboardTotals`
 * logic. For Stage 3 it just surfaces the authenticated user so we have
 * a screen to land on after onboarding.
 */
@HiltViewModel
class DashboardViewModel @Inject constructor(
    authRepository: AuthRepository,
) : ViewModel() {

    val user: StateFlow<User?> = authRepository.authState
        .map { (it as? AuthState.Authenticated)?.user }
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)
}

package com.covault.app.ui.onboarding

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.covault.app.data.model.BudgetCategory
import com.covault.app.data.model.SystemCategories
import com.covault.app.data.model.User
import com.covault.app.data.repository.AuthRepository
import com.covault.app.data.repository.AuthState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Drives the [OnboardingScreen]. The state machine is a small
 * `OnboardingStep` enum that mirrors the React `step` state in
 * `components/Onboarding.tsx`:
 *
 *   Intro1 -> Intro2 -> ChooseMode (Solo | Couples) -> [PartnerEmail?]
 *
 * On completion we save the user's onboarding choice (solo vs couples,
 * optional partner email) into the `settings` table via a stub call —
 * the real SettingsRepository lands in Stage 4. For Stage 3 we just
 * navigate the user forward when they finish.
 */
@HiltViewModel
class OnboardingViewModel @Inject constructor(
    private val authRepository: AuthRepository,
) : ViewModel() {

    enum class Step { INTRO_1, INTRO_2, CHOOSE_MODE, PARTNER_EMAIL }

    data class State(
        val step: Step = Step.INTRO_1,
        val isSolo: Boolean = true,
        val partnerEmail: String = "",
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private val _isCompleting = MutableStateFlow(false)
    val isCompleting: StateFlow<Boolean> = _isCompleting

    /**
     * One-shot signal that the user has finished onboarding. The screen
     * collects this and calls its [onComplete] navigation callback when
     * it flips to `true`. Stays `true` until the screen disposes.
     */
    private val _hasCompleted = MutableStateFlow(false)
    val hasCompleted: StateFlow<Boolean> = _hasCompleted.asStateFlow()

    fun nextFromIntro() {
        _state.update {
            it.copy(step = if (it.step == Step.INTRO_1) Step.INTRO_2 else Step.CHOOSE_MODE)
        }
    }

    fun chooseSolo() {
        _state.update { it.copy(isSolo = true) }
        complete()
    }

    fun chooseCouples() {
        _state.update { it.copy(isSolo = false, step = Step.PARTNER_EMAIL) }
    }

    fun backToChooseMode() {
        _state.update { it.copy(step = Step.CHOOSE_MODE) }
    }

    fun updatePartnerEmail(value: String) {
        _state.update { it.copy(partnerEmail = value) }
    }

    fun finishWithPartner() {
        complete()
    }

    fun skipPartner() {
        _state.update { it.copy(partnerEmail = "") }
        complete()
    }

    /**
     * Persist the user's onboarding choice. Real Supabase write happens
     * in Stage 4 when SettingsRepository is added. For now we navigate
     * forward by flipping a flag the host screen reads.
     */
    private fun complete() {
        if (_isCompleting.value || _hasCompleted.value) return
        _isCompleting.value = true
        viewModelScope.launch {
            // TODO Stage 4: write to settings table with isSolo + partnerEmail.
            // Until then, the dashboard skeleton renders with default budgets.
            _isCompleting.value = false
            _hasCompleted.value = true
        }
    }

    fun defaultBudgets(): List<BudgetCategory> = SystemCategories.ALL
}

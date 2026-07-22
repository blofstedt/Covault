package com.covault.app.ui.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.covault.app.data.repository.ThemePreference
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Backs the settings dark-mode toggle. Reads/writes [ThemePreference]. */
@HiltViewModel
class ThemeViewModel @Inject constructor(
    private val themePreference: ThemePreference,
) : ViewModel() {

    val themeMode: StateFlow<String> = themePreference.themeMode
        .stateIn(viewModelScope, SharingStarted.Eagerly, ThemePreference.MODE_SYSTEM)

    fun set(mode: String) {
        viewModelScope.launch { themePreference.set(mode) }
    }
}

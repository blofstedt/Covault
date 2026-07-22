package com.covault.app.ui.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.covault.app.data.model.VendorOverride
import com.covault.app.data.repository.AuthRepository
import com.covault.app.data.repository.AuthState
import com.covault.app.data.repository.VendorOverrideRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Drives the Learned Rules screen. Loads the user's vendor overrides and
 * exposes the mutations the UI needs. Optimistic updates mirror the React
 * `useVendorOverrides` hook: local state changes immediately, the DB write
 * happens in the background, and on failure we reload from source of truth.
 *
 * Grouping overrides into "rules" (by proper_name + category) is done in the
 * composable, exactly like the React `LearnedRulesCard` useMemo, because the
 * grouping also needs the budget + transaction lists the screen already holds.
 */
@HiltViewModel
class LearnedRulesViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val vendorOverrideRepository: VendorOverrideRepository,
) : ViewModel() {

    val userId: StateFlow<String?> = authRepository.authState
        .map { (it as? AuthState.Authenticated)?.user?.id }
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    private val _overrides = MutableStateFlow<List<VendorOverride>>(emptyList())
    val overrides: StateFlow<List<VendorOverride>> = _overrides.asStateFlow()

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    init {
        viewModelScope.launch {
            userId.collect { id -> if (id != null) reload(id) }
        }
    }

    fun reload(id: String? = userId.value) {
        val uid = id ?: return
        viewModelScope.launch {
            _isLoading.value = true
            _overrides.value = vendorOverrideRepository.loadAll(uid)
            _isLoading.value = false
        }
    }

    /** Reassign every override in [ids] to [categoryName] (a Budgets enum name). */
    fun setCategory(ids: List<String>, categoryName: String) {
        val uid = userId.value ?: return
        if (ids.isEmpty()) return
        _overrides.update { list ->
            list.map { if (it.id in ids) it.copy(categoryName = categoryName) else it }
        }
        viewModelScope.launch {
            var ok = true
            ids.forEach { id ->
                if (vendorOverrideRepository.updateCategory(uid, id, categoryName).isFailure) ok = false
            }
            if (!ok) reload(uid)
        }
    }

    /** Rename every override in [ids] to [properName]. */
    fun setProperName(ids: List<String>, properName: String) {
        val uid = userId.value ?: return
        val name = properName.trim()
        if (ids.isEmpty() || name.isEmpty()) return
        _overrides.update { list ->
            list.map { if (it.id in ids) it.copy(properName = name) else it }
        }
        viewModelScope.launch {
            var ok = true
            ids.forEach { id ->
                if (vendorOverrideRepository.updateProperName(uid, id, name).isFailure) ok = false
            }
            if (!ok) reload(uid)
        }
    }

    fun delete(ids: List<String>) {
        val uid = userId.value ?: return
        if (ids.isEmpty()) return
        _overrides.update { list -> list.filterNot { it.id in ids } }
        viewModelScope.launch {
            var ok = true
            ids.forEach { id ->
                if (vendorOverrideRepository.delete(uid, id).isFailure) ok = false
            }
            if (!ok) reload(uid)
        }
    }

    /**
     * Merge the source overrides into a target rule: every source override
     * adopts the target rule's proper name and category. Mirrors
     * `confirmMerge` in the React `LearnedRulesCard`.
     */
    fun merge(sourceIds: List<String>, targetProperName: String, targetCategoryName: String) {
        val uid = userId.value ?: return
        if (sourceIds.isEmpty()) return
        _overrides.update { list ->
            list.map {
                if (it.id in sourceIds) {
                    it.copy(
                        properName = targetProperName,
                        categoryName = targetCategoryName.ifBlank { it.categoryName },
                    )
                } else it
            }
        }
        viewModelScope.launch {
            var ok = true
            sourceIds.forEach { id ->
                if (vendorOverrideRepository.updateProperName(uid, id, targetProperName).isFailure) ok = false
                if (targetCategoryName.isNotBlank() &&
                    vendorOverrideRepository.updateCategory(uid, id, targetCategoryName).isFailure
                ) ok = false
            }
            if (!ok) reload(uid)
        }
    }
}

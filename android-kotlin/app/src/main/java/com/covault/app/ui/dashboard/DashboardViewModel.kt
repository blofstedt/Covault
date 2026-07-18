package com.covault.app.ui.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.covault.app.data.model.BudgetCategory
import com.covault.app.data.model.PendingTransaction
import com.covault.app.data.model.Transaction
import com.covault.app.data.model.User
import com.covault.app.data.repository.AuthRepository
import com.covault.app.data.repository.AuthState
import com.covault.app.data.repository.TransactionRepository
import com.covault.app.data.repository.UserDataRepository
import com.covault.app.domain.DashboardTotals
import com.covault.app.domain.TransactionNormalizer
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
 * Stage 4a: ViewModel for the dashboard. Pulls real data from Supabase
 * via [UserDataRepository] and surfaces the loaded state plus loading
 * flags. The screen renders the loaded data; Stage 4b replaces this
 * skeleton ViewModel with one that drives the full UI.
 */
@HiltViewModel
class DashboardViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val userDataRepository: UserDataRepository,
    private val transactionRepository: TransactionRepository,
) : ViewModel() {

    val user: StateFlow<User?> = authRepository.authState
        .map { (it as? AuthState.Authenticated)?.user }
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage.asStateFlow()

    private val _budgets = MutableStateFlow<List<BudgetCategory>>(emptyList())
    val budgets: StateFlow<List<BudgetCategory>> = _budgets.asStateFlow()

    private val _transactions = MutableStateFlow<List<Transaction>>(emptyList())
    val transactions: StateFlow<List<Transaction>> = _transactions.asStateFlow()

    private val _pendingTransactions = MutableStateFlow<List<PendingTransaction>>(emptyList())
    val pendingTransactions: StateFlow<List<PendingTransaction>> = _pendingTransactions.asStateFlow()

    init {
        // Auto-load whenever the user changes (login, restore, etc.)
        viewModelScope.launch {
            user.collect { current ->
                if (current != null && _budgets.value.isEmpty()) {
                    refresh(current.id)
                }
            }
        }
    }

    /**
     * Pull fresh data from Supabase. The React `loadUserData` is a single
     * orchestrator that calls 6 sub-loads in order — we match that here.
     */
    fun refresh(userId: String) {
        if (_isLoading.value) return
        _isLoading.value = true
        _errorMessage.value = null
        viewModelScope.launch {
            runCatching { userDataRepository.loadUserData(userId) }
                .onSuccess { data ->
                    val normalized = TransactionNormalizer.normalize(
                        data.transactions, data.budgets,
                    )
                    _budgets.value = data.budgets
                    _transactions.value = normalized
                    _pendingTransactions.value = data.pendingTransactions
                }
                .onFailure { e ->
                    _errorMessage.value = e.message ?: "Failed to load user data"
                }
            _isLoading.value = false
        }
    }

    /**
     * Convenience: month totals derived from the current state. Recomputed
     * on every read (the screen is a leaf component so it doesn't subscribe
     * to a derived StateFlow here).
     */
    fun currentTotals(monthlyIncome: Double): DashboardTotals.Totals =
        DashboardTotals.compute(_transactions.value, monthlyIncome)

    // ---- Transaction CRUD ----------------------------------------------
    //
    // The screen calls these from the action modal / form. Each one
    // optimistically updates local state, then writes to Supabase.
    // On failure, we re-load the user data so the local state
    // converges with the server (the React app does the same in
    // `handleAddTransaction`).

    fun addTransaction(tx: Transaction) {
        val userId = user.value?.id ?: return
        viewModelScope.launch {
            val currentBudgets = _budgets.value
            transactionRepository.add(tx, currentBudgets)
                .onSuccess { saved ->
                    _transactions.update { (listOf(saved) + it).distinctBy { t -> t.id } }
                }
                .onFailure { e ->
                    _errorMessage.value = e.message ?: "Failed to add transaction"
                    refresh(userId)
                }
        }
    }

    fun updateTransaction(tx: Transaction) {
        val userId = user.value?.id ?: return
        viewModelScope.launch {
            transactionRepository.update(tx, _budgets.value)
                .onSuccess { saved ->
                    _transactions.update { list -> list.map { if (it.id == saved.id) saved else it } }
                }
                .onFailure { e ->
                    _errorMessage.value = e.message ?: "Failed to update transaction"
                    refresh(userId)
                }
        }
    }

    fun deleteTransaction(transactionId: String) {
        val userId = user.value?.id ?: return
        viewModelScope.launch {
            transactionRepository.delete(transactionId)
                .onSuccess {
                    _transactions.update { list -> list.filter { it.id != transactionId } }
                }
                .onFailure { e ->
                    _errorMessage.value = e.message ?: "Failed to delete transaction"
                    refresh(userId)
                }
        }
    }
}

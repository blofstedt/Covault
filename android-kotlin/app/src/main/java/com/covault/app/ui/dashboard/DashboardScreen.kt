package com.covault.app.ui.dashboard

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.covault.app.data.model.BudgetCategory
import com.covault.app.data.model.PendingTransaction
import com.covault.app.data.model.SystemCategories
import com.covault.app.data.model.Transaction
import com.covault.app.data.model.TransactionLabel
import com.covault.app.data.model.User
import com.covault.app.domain.DateUtils
import com.covault.app.domain.DashboardTotals
import com.covault.app.ui.theme.CovaultTheme
import java.time.LocalDate

/**
 * Stage 4b-i: The home dashboard. Direct port of `components/Dashboard.tsx`
 * (the home-view code path only — `showParsing` branch + the settings modal
 * land in 4b-ii and 4b-iii).
 *
 * Layout (top to bottom):
 *   1. [DashboardBalanceSection] — gradient balance number, search button, settings cog
 *   2. (Optional) [SearchResults] when the user has typed a query (4b-ii adds this)
 *   3. [BudgetFlowChart] (premium-gated; stub for now)
 *   4. LazyColumn of [BudgetSection]s — collapsible, with spent + projected
 *      gradient bars
 *   5. (Spacer for the bottom bar)
 *   6. [DashboardBottomBar] — home / add / parsing, fixed at the bottom
 */
@Composable
fun DashboardScreen(
    viewModel: DashboardViewModel = hiltViewModel(),
) {
    val user by viewModel.user.collectAsStateWithLifecycle()
    val isLoading by viewModel.isLoading.collectAsStateWithLifecycle()
    val error by viewModel.errorMessage.collectAsStateWithLifecycle()
    val budgets by viewModel.budgets.collectAsStateWithLifecycle()
    val transactions by viewModel.transactions.collectAsStateWithLifecycle()
    val pending by viewModel.pendingTransactions.collectAsStateWithLifecycle()

    DashboardContent(
        user = user,
        isLoading = isLoading,
        error = error,
        budgets = budgets,
        transactions = transactions,
        pending = pending,
        onRefresh = { user?.id?.let(viewModel::refresh) },
    )
}

@Composable
private fun DashboardContent(
    user: User?,
    isLoading: Boolean,
    error: String?,
    budgets: List<BudgetCategory>,
    transactions: List<Transaction>,
    pending: List<PendingTransaction>,
    onRefresh: () -> Unit,
) {
    val isShared = user?.budgetingSolo == false
    val monthlyIncome = user?.monthlyIncome ?: 0.0
    val totals = remember(transactions, monthlyIncome) {
        DashboardTotals.compute(transactions, monthlyIncome, LocalDate.now())
    }
    val aiCount = transactions.count { it.label == TransactionLabel.AUTOMATIC && !it.caughtCleared }
    val pendingTotal = pending.size + aiCount

    var searchQuery by remember { mutableStateOf("") }
    var isSearchOpen by remember { mutableStateOf(false) }
    var expandedBudgets by remember { mutableStateOf<Set<String>>(emptySet()) }

    Box(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background)
                .windowInsetsPadding(WindowInsets.systemBars),
        ) {
            DashboardBalanceSection(
                isSharedAccount = isShared,
                remainingMoney = totals.remainingMoney,
                monthlyIncome = monthlyIncome,
                searchQuery = searchQuery,
                isSearchOpen = isSearchOpen,
                onSearchQueryChange = {
                    searchQuery = it
                    if (it.isNotBlank()) isSearchOpen = true
                },
                onSearchOpenChange = { isSearchOpen = it },
                onOpenSettings = { /* Stage 4b-iii */ },
            )

            Spacer(Modifier.height(4.dp))

            // Error / loading block
            when {
                isLoading -> Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                ) {
                    CircularProgressIndicator(
                        modifier = Modifier.height(14.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    Text(
                        text = "Loading your vault…",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                error != null -> Text(
                    text = error,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                )
            }

            // Budget list. Only show non-Other budgets in the home view;
            // Other is rendered at the bottom of the list, matching the
            // React `sort` comparator in DashboardBudgetSectionsList.
            val sortedBudgets = remember(budgets) {
                budgets.sortedBy { it.name.equals("Other", ignoreCase = true) }
            }
            val currentMonth = remember(transactions) {
                val monthKey = DateUtils.getLocalMonthKey(LocalDate.now().toString())
                transactions.filter { DateUtils.getLocalMonthKey(it.date) == monthKey }
            }
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .weight(1f),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(sortedBudgets, key = { it.id }) { budget ->
                    val isExpanded = budget.id in expandedBudgets
                    val budgetTxs = currentMonth.filter { it.budgetId == budget.id }
                    BudgetSection(
                        budget = budget,
                        transactions = budgetTxs,
                        isExpanded = isExpanded,
                        onToggle = {
                            expandedBudgets = if (isExpanded) emptySet() else setOf(budget.id)
                        },
                        onTransactionTap = { /* Stage 4b-ii: open action modal */ },
                        currentUserName = user?.name.orEmpty(),
                        isSharedView = isShared,
                        allBudgets = sortedBudgets,
                        useCompactCollapsedStyles = expandedBudgets.isEmpty(),
                    )
                }
            }

            // Spacer for the fixed bottom bar
            Spacer(Modifier.height(96.dp))
        }

        // Fixed bottom bar
        Box(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth(),
        ) {
            DashboardBottomBar(
                onGoHome = { expandedBudgets = emptySet() },
                onAddTransaction = { /* Stage 4b-ii: open form */ },
                onOpenParsing = { /* Stage 6 */ },
                activeView = "home",
                pendingCount = pendingTotal,
            )
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun DashboardScreenPreview() {
    CovaultTheme {
        DashboardContent(
            user = User(id = "u-1", name = "Mavis", email = "mavis@example.com", monthlyIncome = 5000.0),
            isLoading = false,
            error = null,
            budgets = SystemCategories.ALL,
            transactions = listOf(
                Transaction(
                    id = "t-1", userId = "u-1", vendor = "Amazon",
                    amount = -49.99, date = "2026-07-18T12:00:00.000Z",
                    budgetId = SystemCategories.GROCERIES.id,
                    createdAt = "2026-07-18T12:00:00.000Z",
                ),
                Transaction(
                    id = "t-2", userId = "u-1", vendor = "Whole Foods",
                    amount = -87.32, date = "2026-07-17T12:00:00.000Z",
                    budgetId = SystemCategories.GROCERIES.id,
                    createdAt = "2026-07-17T12:00:00.000Z",
                ),
            ),
            pending = emptyList(),
            onRefresh = {},
        )
    }
}

package com.covault.app.ui.dashboard

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.covault.app.data.model.BudgetCategory
import com.covault.app.data.model.PendingTransaction
import com.covault.app.data.model.Transaction
import com.covault.app.data.model.TransactionLabel
import com.covault.app.data.model.User
import com.covault.app.domain.FormatVendorName
import com.covault.app.ui.components.CovaultLogoMark
import com.covault.app.ui.theme.CovaultTheme

/**
 * Stage 4a dashboard. Renders real data loaded from Supabase:
 *  - User name + email in the header
 *  - Loading spinner while [DashboardViewModel.isLoading] is true
 *  - Error message if the load failed
 *  - The current month's transactions (real, sorted by date desc)
 *  - The user's budget list with current limits
 *  - The pending-transaction count (the "AI caught" badge)
 *
 * Stage 4b replaces this with the full visual port of `Dashboard.tsx` —
 * budget flow chart, expandable budget bars, transaction form, settings
 * modal, the works. This Stage 4a is intentionally data-first: it
 * proves the data layer round-trips against your real Supabase project.
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
        pendingCount = pending.size,
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
    pendingCount: Int,
    onRefresh: () -> Unit,
) {
    val aiCount = transactions.count { it.label == TransactionLabel.AUTOMATIC && !it.caughtCleared }
    val currentMonth = transactions
        .sortedByDescending { it.date }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .windowInsetsPadding(WindowInsets.systemBars),
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 24.dp),
        ) {
            item { Header(user = user, pendingCount = pendingCount + aiCount, onRefresh = onRefresh) }
            item { Spacer(Modifier.height(4.dp)) }
            item { ErrorOrLoadingBlock(isLoading = isLoading, error = error) }
            item { BudgetsSection(budgets = budgets) }
            item {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
            item { TransactionsSection(transactions = currentMonth) }
        }
    }
}

@Composable
private fun Header(user: User?, pendingCount: Int, onRefresh: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CovaultLogoMark(size = 48)
        Spacer(Modifier.size(12))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = "Welcome back${user?.name?.let { ", $it" } ?: ""}",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onBackground,
            )
            if (user != null) {
                Text(
                    text = user.email,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (pendingCount > 0) {
            Surface(
                color = MaterialTheme.colorScheme.primaryContainer,
                shape = androidx.compose.foundation.shape.CircleShape,
            ) {
                Text(
                    text = pendingCount.toString(),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                )
            }
        }
    }
}

@Composable
private fun ErrorOrLoadingBlock(isLoading: Boolean, error: String?) {
    when {
        isLoading -> Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            CircularProgressIndicator(
                modifier = Modifier.size(16.dp),
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
        )
        else -> {} // nothing
    }
}

@Composable
private fun BudgetsSection(budgets: List<BudgetCategory>) {
    Column {
        Text(
            text = "Budgets (${budgets.size})",
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Spacer(Modifier.height(8.dp))
        budgets.forEach { b ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = b.name,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onBackground,
                )
                Text(
                    text = "$%.0f".format(b.totalLimit),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun TransactionsSection(transactions: List<Transaction>) {
    Column {
        Text(
            text = "Transactions (${transactions.size})",
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Spacer(Modifier.height(8.dp))
        if (transactions.isEmpty()) {
            Text(
                text = "No transactions yet. Stage 4b adds the form to add one.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            return
        }
        transactions.take(20).forEach { tx ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = FormatVendorName.formatVendorName(tx.vendor),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onBackground,
                    )
                    Text(
                        text = tx.date.take(10),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Text(
                    text = "$%.2f".format(tx.amount),
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (tx.amount < 0) MaterialTheme.colorScheme.error
                            else MaterialTheme.colorScheme.onBackground,
                )
            }
        }
        if (transactions.size > 20) {
            Text(
                text = "+ ${transactions.size - 20} more",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(vertical = 8.dp),
            )
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun DashboardScreenPreview() {
    CovaultTheme {
        DashboardContent(
            user = User(id = "u-1", name = "Mavis", email = "mavis@example.com"),
            isLoading = false,
            error = null,
            budgets = BudgetCategory.let {
                listOf(
                    BudgetCategory("11111111-1111-1111-1111-111111111111", "Housing", 1500.0),
                    BudgetCategory("22222222-2222-2222-2222-222222222222", "Groceries", 500.0),
                )
            },
            transactions = listOf(
                Transaction(
                    id = "t-1", userId = "u-1", vendor = "Amazon",
                    amount = -49.99, date = "2026-07-18T12:00:00.000Z",
                    budgetId = "22222222-2222-2222-2222-222222222222",
                    createdAt = "2026-07-18T12:00:00.000Z",
                ),
                Transaction(
                    id = "t-2", userId = "u-1", vendor = "Whole Foods",
                    amount = -87.32, date = "2026-07-17T12:00:00.000Z",
                    budgetId = "22222222-2222-2222-2222-222222222222",
                    createdAt = "2026-07-17T12:00:00.000Z",
                ),
            ),
            pendingCount = 2,
            onRefresh = {},
        )
    }
}

package com.covault.app.ui.dashboard

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.covault.app.data.model.BudgetCategory
import com.covault.app.data.model.Transaction
import com.covault.app.domain.DateUtils

/**
 * Search results panel. Direct port of `components/dashboard_components/SearchResults.tsx`.
 *
 * Three collapsible sections: This Month, Past Transactions, Future
 * Transactions. Filters by vendor name (case-insensitive `includes`),
 * matching the React `filterFn`.
 *
 * Refund matching is a no-op for Stage 4b-ii (the real
 * `lib/refundMatching.ts` integration lands in Stage 6 when the
 * notification pipeline is wired).
 */
@Composable
fun SearchResults(
    searchQuery: String,
    currentMonthTransactions: List<Transaction>,
    pastTransactions: List<Transaction>,
    futureTransactions: List<Transaction>,
    currentUserName: String,
    isSharedAccount: Boolean,
    budgets: List<BudgetCategory>,
    onTransactionTap: (Transaction) -> Unit,
) {
    val q = searchQuery.lowercase().trim()
    val filterFn: (Transaction) -> Boolean = { it.vendor.lowercase().contains(q) && it.amount >= 0 }

    val filteredCurrent = currentMonthTransactions.filter(filterFn)
    val filteredPast = pastTransactions.filter(filterFn)
    val filteredFuture = futureTransactions.filter(filterFn)
    val hasAny = filteredCurrent.isNotEmpty() || filteredPast.isNotEmpty() || filteredFuture.isNotEmpty()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 4.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                text = "Search Results",
                style = TextStyle(
                    fontSize = 10.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.outline,
                ),
            )
            Text(
                text = "\u201C$searchQuery\u201D",
                style = TextStyle(
                    fontSize = 9.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                ),
            )
        }

        if (filteredCurrent.isNotEmpty()) {
            Text(
                text = "This Month",
                style = TextStyle(
                    fontSize = 9.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                ),
                modifier = Modifier.padding(start = 4.dp, top = 8.dp, bottom = 4.dp),
            )
            filteredCurrent.forEach { tx ->
                TransactionItem(
                    transaction = tx,
                    onTap = onTransactionTap,
                    currentUserName = currentUserName,
                    isSharedView = isSharedAccount,
                    currentBudgetId = tx.budgetId,
                    budgets = budgets,
                    showBudgetIcon = true,
                )
                Spacer(Modifier.height(8.dp))
            }
        }

        CollapsibleSection(
            title = "Past Transactions",
            subtitle = "Before this month",
            transactions = filteredPast,
            currentUserName = currentUserName,
            isSharedAccount = isSharedAccount,
            budgets = budgets,
            onTransactionTap = onTransactionTap,
        )

        CollapsibleSection(
            title = "Future Transactions",
            subtitle = "Scheduled future entries",
            transactions = filteredFuture,
            currentUserName = currentUserName,
            isSharedAccount = isSharedAccount,
            budgets = budgets,
            onTransactionTap = onTransactionTap,
        )

        if (!hasAny) {
            Text(
                text = "No entries found",
                style = TextStyle(
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 32.dp),
            )
            Text(
                text = "Try a different vendor name or check another month.",
                style = TextStyle(
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                ),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun CollapsibleSection(
    title: String,
    subtitle: String,
    transactions: List<Transaction>,
    currentUserName: String,
    isSharedAccount: Boolean,
    budgets: List<BudgetCategory>,
    onTransactionTap: (Transaction) -> Unit,
) {
    if (transactions.isEmpty()) return
    var open by remember { mutableStateOf(false) }
    Column(modifier = Modifier.padding(top = 12.dp)) {
        Surface(
            onClick = { open = !open },
            color = MaterialTheme.colorScheme.surfaceVariant,
            shape = RoundedCornerShape(20.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = title,
                        style = TextStyle(
                            fontSize = 10.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        ),
                    )
                    Text(
                        text = "$subtitle · ${transactions.size} entr${if (transactions.size == 1) "y" else "ies"}",
                        style = TextStyle(
                            fontSize = 9.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        ),
                        modifier = Modifier.padding(top = 2.dp),
                    )
                }
                Text(
                    text = if (open) "HIDE" else "SHOW",
                    style = TextStyle(
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Black,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    ),
                )
            }
        }
        if (open) {
            Column(modifier = Modifier.padding(top = 8.dp)) {
                transactions.forEach { tx ->
                    TransactionItem(
                        transaction = tx,
                        onTap = onTransactionTap,
                        currentUserName = currentUserName,
                        isSharedView = isSharedAccount,
                        currentBudgetId = tx.budgetId,
                        budgets = budgets,
                        showBudgetIcon = true,
                    )
                    Spacer(Modifier.height(8.dp))
                }
            }
        }
    }
}

package com.covault.app.ui.dashboard

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.covault.app.data.model.BudgetCategory
import com.covault.app.data.model.Transaction
import com.covault.app.domain.BudgetColors

/**
 * One budget card. Direct port of `components/BudgetSection.tsx`.
 *
 * Renders either in collapsed mode (just icon + name + limit, with a
 * thin spent/projected progress bar in the background) or expanded
 * mode (full transaction list visible).
 *
 * Tap on the header toggles expansion. The animated visibility uses
 * Compose's standard `expandVertically`/`shrinkVertically` so the
 * expansion interpolates smoothly.
 */
@Composable
fun BudgetSection(
    budget: BudgetCategory,
    transactions: List<Transaction>,
    isExpanded: Boolean,
    onToggle: () -> Unit,
    onTransactionTap: (Transaction) -> Unit,
    currentUserName: String,
    isSharedView: Boolean,
    allBudgets: List<BudgetCategory> = emptyList(),
    useCompactCollapsedStyles: Boolean = false,
) {
    val color = remember(budget.name) { BudgetColors.getColor(budget.name) }

    val spent = transactions
        .filter { !it.isProjected && it.budgetId == budget.id }
        .sumOf { it.amount }
    val projected = transactions
        .filter { it.isProjected && it.budgetId == budget.id }
        .sumOf { it.amount }
    val external = budget.externalDeduction ?: 0.0
    val total = spent + external + projected
    val limit = budget.totalLimit.coerceAtLeast(0.0)
    val isOver = total > limit
    val spentPercent = if (limit > 0) (total / limit * 100.0) else 0.0
    val isWarning = spentPercent in 80.0..100.0
    val isOver100 = spentPercent > 100.0

    val spentWidth = if (limit > 0) (kotlin.math.max(0.0, spent + external) / limit * 100.0) else 0.0
    val projectedWidth = if (limit > 0) (kotlin.math.max(0.0, projected) / limit * 100.0) else 0.0
    val spentAnim by animateFloatAsState(
        targetValue = spentWidth.coerceAtMost(100.0).toFloat(),
        label = "spent-width",
    )
    val projectedAnim by animateFloatAsState(
        targetValue = projectedWidth.coerceAtMost((100.0 - spentWidth).coerceAtLeast(0.0)).toFloat(),
        label = "projected-width",
    )

    Surface(
        color = if (isExpanded) MaterialTheme.colorScheme.surface
                else MaterialTheme.colorScheme.surface.copy(alpha = 0.7f),
        shape = RoundedCornerShape(28.dp),
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 64.dp)
            .border(
                width = if (isExpanded) 1.dp else 1.dp,
                color = if (isExpanded) color.copy(alpha = 0.6f)
                        else MaterialTheme.colorScheme.outlineVariant,
                shape = RoundedCornerShape(28.dp),
            )
            .clickable(onClick = onToggle),
    ) {
        Column(modifier = Modifier.fillMaxWidth()) {
            // Gradient background bars (spent + projected)
            Box(modifier = Modifier.fillMaxWidth().height(64.dp)) {
                Row(modifier = Modifier.fillMaxSize()) {
                    // Spent bar
                    Box(
                        modifier = Modifier
                            .weight(spentAnim.coerceAtLeast(0.001f))
                            .fillMaxSize()
                            .background(
                                brush = Brush.horizontalGradient(
                                    colors = listOf(
                                        color.copy(alpha = 0.35f),
                                        color.copy(alpha = 0.5f),
                                    ),
                                ),
                            ),
                    )
                    if (spentAnim < 100f) {
                        Box(
                            modifier = Modifier
                                .weight((100f - spentAnim - projectedAnim).coerceAtLeast(0.001f))
                                .fillMaxSize(),
                        )
                    }
                    if (projectedAnim > 0f) {
                        Box(
                            modifier = Modifier
                                .weight(projectedAnim.coerceAtLeast(0.001f))
                                .fillMaxSize()
                                .background(
                                    color = color.copy(alpha = 0.10f),
                                ),
                        )
                    }
                }

                // Header content overlaid on the bar
                Header(
                    budget = budget,
                    color = color,
                    isExpanded = isExpanded,
                    useCompact = useCompactCollapsedStyles,
                    isOver = isOver,
                    isWarning = isWarning,
                    isOver100 = isOver100,
                    spent = spent,
                    projected = projected,
                    total = total,
                )
            }

            AnimatedVisibility(
                visible = isExpanded,
                enter = expandVertically() + fadeIn(),
                exit = shrinkVertically() + fadeOut(),
            ) {
                ExpandedTransactions(
                    transactions = transactions.filter { it.amount >= 0 || it.isIncome },
                    onTransactionTap = onTransactionTap,
                    currentUserName = currentUserName,
                    isSharedView = isSharedView,
                    allBudgets = allBudgets,
                )
            }
        }
    }
}

@Composable
private fun Header(
    budget: BudgetCategory,
    color: Color,
    isExpanded: Boolean,
    useCompact: Boolean,
    isOver: Boolean,
    isWarning: Boolean,
    isOver100: Boolean,
    spent: Double,
    projected: Double,
    total: Double,
) {
    Row(
        modifier = Modifier
            .fillMaxSize()
            .padding(
                horizontal = if (useCompact && !isExpanded) 12.dp else 16.dp,
                vertical = if (useCompact && !isExpanded) 6.dp else 12.dp,
            ),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(if (isExpanded) 48.dp else 36.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(if (isExpanded) color else color.copy(alpha = 0.0f))
                .border(
                    width = if (isExpanded) 0.dp else 1.dp,
                    color = color.copy(alpha = 0.3f),
                    shape = RoundedCornerShape(14.dp),
                ),
            contentAlignment = Alignment.Center,
        ) {
            BudgetIcon(
                name = budget.name,
                tint = if (isExpanded) Color.White else color,
                size = if (isExpanded) 22.dp else 18.dp,
            )
        }
        Spacer(Modifier.width(if (useCompact && !isExpanded) 8.dp else 12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = budget.name,
                style = TextStyle(
                    fontSize = if (useCompact && !isExpanded) 12.sp else 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onBackground,
                ),
            )
            if (!isExpanded) {
                val subtitle = if (isOver) {
                    "Over by $${"%.0f".format(kotlin.math.max(0.0, total - budget.totalLimit))}"
                } else {
                    "$${"%.0f".format(kotlin.math.max(0.0, budget.totalLimit - total))} left"
                }
                Text(
                    text = subtitle,
                    style = TextStyle(
                        fontSize = if (useCompact) 10.sp else 11.sp,
                        fontWeight = if (isOver100) FontWeight.ExtraBold else FontWeight.Bold,
                        color = when {
                            isOver100 -> MaterialTheme.colorScheme.onBackground
                            isWarning -> MaterialTheme.colorScheme.onBackground.copy(alpha = 0.7f)
                            else -> MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    ),
                )
            }
        }
        Spacer(Modifier.width(8.dp))
        Column(horizontalAlignment = Alignment.End) {
            if (isExpanded) {
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(
                        text = "$${"%.0f".format(total)}",
                        style = TextStyle(
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        ),
                    )
                    Text(
                        text = " / ",
                        style = TextStyle(
                            fontSize = 14.sp,
                            color = MaterialTheme.colorScheme.outline,
                        ),
                    )
                    Text(
                        text = "$${"%.0f".format(budget.totalLimit)}",
                        style = TextStyle(
                            fontSize = 20.sp,
                            fontWeight = FontWeight.ExtraBold,
                            color = MaterialTheme.colorScheme.onBackground,
                        ),
                    )
                }
                Text(
                    text = "Vault Capacity",
                    style = TextStyle(
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    ),
                )
            } else {
                Text(
                    text = "$${"%.0f".format(budget.totalLimit)}",
                    style = TextStyle(
                        fontSize = if (useCompact) 12.sp else 14.sp,
                        fontWeight = FontWeight.Black,
                        color = MaterialTheme.colorScheme.onBackground,
                    ),
                )
            }
        }
    }
}

@Composable
private fun ExpandedTransactions(
    transactions: List<Transaction>,
    onTransactionTap: (Transaction) -> Unit,
    currentUserName: String,
    isSharedView: Boolean,
    allBudgets: List<BudgetCategory>,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .padding(bottom = 8.dp),
    ) {
        Text(
            text = if (isSharedView) "Our Activity" else "Activity",
            style = TextStyle(
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            ),
            modifier = Modifier.padding(start = 8.dp, top = 4.dp, bottom = 4.dp),
        )
        if (transactions.isEmpty()) {
            Text(
                text = "No entries found",
                style = TextStyle(
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 24.dp),
            )
            return
        }
        transactions.forEach { tx ->
            TransactionItem(
                transaction = tx,
                onTap = onTransactionTap,
                currentUserName = currentUserName,
                isSharedView = isSharedView,
                currentBudgetId = tx.budgetId,
                budgets = allBudgets,
                showBudgetIcon = false,
            )
            Spacer(Modifier.height(8.dp))
        }
    }
}

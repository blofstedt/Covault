package com.covault.app.ui.dashboard

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.covault.app.data.model.BudgetCategory
import com.covault.app.data.model.Recurrence
import com.covault.app.data.model.Transaction
import com.covault.app.data.model.TransactionLabel
import com.covault.app.domain.DateUtils
import java.time.LocalDate

/**
 * Single transaction row inside an expanded BudgetSection.
 * Direct port of `components/TransactionItem.tsx`.
 *
 *  - Vendor name, date pill, optional recurrence/AI/Projected/Future badges
 *  - Amount on the right; refunds shown with a + sign
 *  - When `isRefunded` is true, the row is dimmed and the vendor +
 *    amount get a strikethrough
 *  - Optional budget icon on the left when used in search results
 */
@Composable
fun TransactionItem(
    transaction: Transaction,
    onTap: (Transaction) -> Unit,
    currentUserName: String,
    isSharedView: Boolean,
    currentBudgetId: String? = null,
    budgets: List<BudgetCategory>? = null,
    showBudgetIcon: Boolean = false,
    isRefunded: Boolean = false,
) {
    val amount = transaction.amount
    val isRefund = amount < 0
    val isOtherUser = isSharedView && transaction.userName != currentUserName
    val parsedDate = runCatching { DateUtils.parseLocalDate(transaction.date) }.getOrDefault(LocalDate.now())
    val isFuture = !transaction.isProjected && parsedDate.isAfter(LocalDate.now())
    val matchedBudget = budgets
        ?.takeIf { showBudgetIcon }
        ?.firstOrNull { it.id == transaction.budgetId }

    Surface(
        onClick = { onTap(transaction) },
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(24.dp),
        modifier = Modifier
            .fillMaxWidth()
            .border(
                width = 1.dp,
                color = MaterialTheme.colorScheme.outlineVariant,
                shape = RoundedCornerShape(24.dp),
            ),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (showBudgetIcon && matchedBudget != null) {
                Box(
                    modifier = Modifier
                        .size(40.dp)
                        .background(
                            color = MaterialTheme.colorScheme.surfaceVariant,
                            shape = RoundedCornerShape(12.dp),
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    BudgetIcon(
                        name = matchedBudget.name,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        size = 20.dp,
                    )
                }
                Spacer(Modifier.width(12.dp))
            }

            Column(modifier = Modifier.weight(1f)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(
                        text = transaction.vendor,
                        style = TextStyle(
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold,
                            color = if (isRefunded) MaterialTheme.colorScheme.outline
                                    else MaterialTheme.colorScheme.onBackground,
                            textDecoration = if (isRefunded) TextDecoration.LineThrough else null,
                        ),
                    )
                    if (isSharedView && !transaction.userName.isNullOrBlank()) {
                        Pill(
                            text = transaction.userName.split(" ").firstOrNull().orEmpty(),
                            background = if (isOtherUser) MaterialTheme.colorScheme.tertiaryContainer
                                        else MaterialTheme.colorScheme.primaryContainer,
                            foreground = if (isOtherUser) MaterialTheme.colorScheme.onTertiaryContainer
                                         else MaterialTheme.colorScheme.onPrimaryContainer,
                        )
                    }
                    Pill(
                        text = parsedDate.format(java.time.format.DateTimeFormatter.ofPattern("MMM d")),
                        background = MaterialTheme.colorScheme.surfaceVariant,
                        foreground = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 10.sp,
                    )
                    if (transaction.recurrence != Recurrence.ONE_TIME) {
                        Pill(
                            text = transaction.recurrence.dbValue,
                            background = MaterialTheme.colorScheme.surfaceVariant,
                            foreground = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 8.sp,
                        )
                    }
                    if (transaction.isProjected) {
                        Pill(
                            text = "Projected",
                            background = MaterialTheme.colorScheme.tertiaryContainer,
                            foreground = MaterialTheme.colorScheme.onTertiaryContainer,
                            fontSize = 8.sp,
                        )
                    }
                    if (isFuture) {
                        Pill(
                            text = "Future",
                            background = MaterialTheme.colorScheme.secondaryContainer,
                            foreground = MaterialTheme.colorScheme.onSecondaryContainer,
                            fontSize = 8.sp,
                        )
                    }
                    if (transaction.label == TransactionLabel.AUTOMATIC) {
                        Pill(
                            text = "AI",
                            background = MaterialTheme.colorScheme.secondaryContainer,
                            foreground = MaterialTheme.colorScheme.onSecondaryContainer,
                            fontSize = 8.sp,
                        )
                    }
                    if (isRefund) {
                        Pill(
                            text = if (transaction.isIncome) "Income" else "Refund",
                            background = MaterialTheme.colorScheme.primaryContainer,
                            foreground = MaterialTheme.colorScheme.onPrimaryContainer,
                            fontSize = 8.sp,
                        )
                    }
                }
            }

            Spacer(Modifier.width(8.dp))

            Column(horizontalAlignment = Alignment.End) {
                Text(
                    text = "${if (isRefund) "+" else ""}$${"%.2f".format(kotlin.math.abs(amount))}",
                    style = TextStyle(
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Black,
                        color = when {
                            isRefunded -> MaterialTheme.colorScheme.outline
                            isRefund -> MaterialTheme.colorScheme.primary
                            transaction.isProjected -> MaterialTheme.colorScheme.outline
                            else -> MaterialTheme.colorScheme.onBackground
                        },
                        textDecoration = if (isRefunded) TextDecoration.LineThrough else null,
                    ),
                )
                if (isRefunded) {
                    Text(
                        text = "Refunded",
                        style = TextStyle(
                            fontSize = 9.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.primary,
                        ),
                    )
                }
            }
        }
    }
}

@Composable
private fun Pill(
    text: String,
    background: androidx.compose.ui.graphics.Color,
    foreground: androidx.compose.ui.graphics.Color,
    fontSize: androidx.compose.ui.unit.TextUnit = 10.sp,
) {
    if (text.isBlank()) return
    Box(
        modifier = Modifier
            .background(color = background, shape = RoundedCornerShape(8.dp))
            .padding(horizontal = 6.dp, vertical = 2.dp),
    ) {
        Text(
            text = text,
            style = TextStyle(
                fontSize = fontSize,
                fontWeight = FontWeight.Bold,
                color = foreground,
            ),
        )
    }
}

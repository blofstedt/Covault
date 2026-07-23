package com.covault.app.ui.dashboard

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.covault.app.data.model.BudgetCategory
import com.covault.app.data.model.Transaction
import com.covault.app.domain.BudgetColors
import com.covault.app.domain.DateUtils
import java.time.LocalDate
import java.time.format.DateTimeFormatter

/**
 * Budget flow chart. Stub implementation that ships in Stage 4b-iv.
 *
 * The React `BudgetFlowChart.tsx` is a 300-LOC D3 stacked-area chart
 * with month-by-month breakdown, hover tooltips, and morph animations
 * when a budget is highlighted. Porting that to Compose is a
 * 600-1000-LOC effort involving custom Canvas drawing + pointer
 * input handling + a tooltip overlay.
 *
 * This stub gives us:
 *  - A bar-per-category breakdown for the current month
 *  - The correct color gradient (matches the React palette)
 *  - A small bar showing monthly-income threshold as a faint line
 *  - Category legend below
 *
 * Real interactive D3-style chart lands in a follow-up stage. The
 * `chartData` derivation below is the same shape the React chart
 * uses, so swapping in a real visualization is a 1:1 replacement.
 */
@Composable
fun BudgetFlowChart(
    budgets: List<BudgetCategory>,
    transactions: List<Transaction>,
    monthlyIncome: Double = 0.0,
    modifier: Modifier = Modifier,
) {
    val now = LocalDate.now()
    val monthKey = now.format(DateTimeFormatter.ofPattern("yyyy-MM"))
    val currentMonthTransactions = remember(transactions, monthKey) {
        transactions.filter { DateUtils.getLocalMonthKey(it.date) == monthKey }
    }

    val byCategory = remember(currentMonthTransactions) {
        currentMonthTransactions
            .filter { it.budgetId != null }
            .groupBy { it.budgetId!! }
            .mapValues { (_, txs) -> txs.sumOf { it.amount } }
    }
    val totalLimit = budgets.sumOf { it.totalLimit }
    val totalSpent = currentMonthTransactions.sumOf { kotlin.math.abs(it.amount) }
    val incomeLineRatio = if (totalLimit > 0) (monthlyIncome / totalLimit).toFloat().coerceIn(0f, 1f) else 0f

    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(28.dp),
        modifier = modifier
            .fillMaxWidth()
            .border(
                width = 1.dp,
                color = MaterialTheme.colorScheme.outlineVariant,
                shape = RoundedCornerShape(28.dp),
            ),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            // Header
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Budget Flow",
                    style = TextStyle(
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface,
                    ),
                    modifier = Modifier.weight(1f),
                )
                Text(
                    text = "$${totalSpent.toInt()} / $${totalLimit.toInt()}",
                    style = TextStyle(
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    ),
                )
            }
            Spacer(Modifier.height(12.dp))

            // Stacked bar
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
            ) {
                Canvas(modifier = Modifier.fillMaxSize()) {
                    val barWidth = size.width
                    val barHeight = size.height
                    var x = 0f
                    budgets.forEachIndexed { index, budget ->
                        val spent = kotlin.math.abs(byCategory[budget.id] ?: 0.0)
                        val ratio = if (totalLimit > 0) (spent / totalLimit).toFloat() else 0f
                        val segmentWidth = barWidth * ratio
                        val (start, end) = BudgetColors.getGradient(budget.name, index)
                        drawRect(
                            brush = Brush.horizontalGradient(
                                colors = listOf(start, end),
                                startX = x,
                                endX = x + segmentWidth,
                            ),
                            topLeft = Offset(x, 0f),
                            size = Size(segmentWidth, barHeight),
                        )
                        x += segmentWidth
                    }
                    // Faint income line (only if income is set and fits the bar)
                    if (incomeLineRatio > 0f && incomeLineRatio < 1f) {
                        val lineX = barWidth * incomeLineRatio
                        drawLine(
                            color = Color(0xFF6b7280),  // slate-500
                            start = Offset(lineX, 0f),
                            end = Offset(lineX, barHeight),
                            strokeWidth = 2f,
                        )
                    }
                    // Bar outline
                    drawRect(
                        color = Color(0x33000000),
                        topLeft = Offset.Zero,
                        size = Size(barWidth, barHeight),
                        style = Stroke(width = 1f),
                    )
                }
            }
            Spacer(Modifier.height(12.dp))

            // Legend
            LazyRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                items(budgets, key = { it.id }) { budget ->
                    val (color, _) = BudgetColors.getGradient(budget.name)
                    val spent = kotlin.math.abs(byCategory[budget.id] ?: 0.0)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(10.dp)
                                .background(color = color, shape = RoundedCornerShape(2.dp)),
                        )
                        Spacer(Modifier.size(6.dp))
                        Text(
                            text = "${budget.name}  $${spent.toInt()}",
                            style = TextStyle(
                                fontSize = 10.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            ),
                        )
                    }
                }
            }
        }
    }
}

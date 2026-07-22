package com.covault.app.ui.dashboard

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.covault.app.data.model.BudgetCategory
import com.covault.app.data.model.Transaction
import com.covault.app.domain.BudgetColors
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import kotlin.math.abs

/**
 * Budget flow chart — a Compose port of the React D3 `BudgetFlowChart.tsx`:
 * a smoothed (Catmull-Rom) stacked-area chart of per-category spend across
 * up to 6 months, with per-category vertical gradients, subtle grid lines,
 * and an income/budget threshold line. Give it the FULL transaction list
 * (not just the current month) so it has multiple months to plot.
 */

private data class MonthPoint(
    val key: String,
    val label: String,
    val byName: Map<String, Double>,
    val total: Double,
)

private val MONTHS = arrayOf(
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
)

private fun monthLabel(key: String): String {
    val parts = key.split("-")
    if (parts.size < 2) return key
    val m = parts[1].toIntOrNull() ?: return key
    return "${MONTHS.getOrElse(m - 1) { "" }} ${parts[0].takeLast(2)}"
}

/** Keep at most [max] months, centred on the current month when possible. */
private fun windowMonths(keys: List<String>, current: String, max: Int = 6): List<String> {
    if (keys.size <= max) return keys
    var idx = keys.indexOf(current)
    if (idx < 0) {
        idx = keys.indexOfFirst { it > current }
        if (idx < 0) idx = keys.size - 1
    }
    var start = idx - max / 2
    start = start.coerceIn(0, keys.size - max)
    return keys.subList(start, start + max)
}

private fun buildMonthly(
    transactions: List<Transaction>,
    budgets: List<BudgetCategory>,
): List<MonthPoint> {
    val categoryNames = budgets.map { it.name }
    if (categoryNames.isEmpty()) return emptyList()
    val nameById = budgets.associate { it.id to it.name }

    val monthMap = linkedMapOf<String, MutableMap<String, Double>>()
    for (tx in transactions) {
        if (tx.isIncome) continue
        if (tx.date.length < 7) continue
        val key = tx.date.substring(0, 7)   // YYYY-MM straight off the string
        val amount = abs(tx.amount)
        if (amount == 0.0) continue
        val name = tx.budgetId?.let { nameById[it] } ?: "Other"
        val cat = monthMap.getOrPut(key) { mutableMapOf() }
        cat[name] = (cat[name] ?: 0.0) + amount
    }

    val current = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyy-MM"))
    val display = windowMonths(monthMap.keys.sorted(), current)

    val points = display.map { key ->
        val cat = monthMap[key].orEmpty()
        val values = categoryNames.associateWith { cat[it] ?: 0.0 }
        MonthPoint(key, monthLabel(key), values, values.values.sum())
    }
    // Always render a baseline even with no history.
    return points.ifEmpty {
        listOf(MonthPoint(current, monthLabel(current), categoryNames.associateWith { 0.0 }, 0.0))
    }
}

@Composable
fun BudgetFlowChart(
    budgets: List<BudgetCategory>,
    transactions: List<Transaction>,
    monthlyIncome: Double = 0.0,
    modifier: Modifier = Modifier,
) {
    val categoryNames = remember(budgets) { budgets.map { it.name } }
    val months = remember(transactions, budgets) { buildMonthly(transactions, budgets) }
    val totalLimit = remember(budgets) { budgets.sumOf { it.totalLimit } }
    val threshold = if (monthlyIncome > 0) monthlyIncome else totalLimit

    // Header summary uses the most recent month in the window.
    val latest = months.lastOrNull()
    val latestSpent = latest?.total ?: 0.0

    val gridColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.06f)
    val thresholdColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
    val gradients = remember(categoryNames) {
        categoryNames.mapIndexed { i, name -> BudgetColors.getGradient(name, i) }
    }

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
                    text = "$${latestSpent.toInt()} / $${totalLimit.toInt()}",
                    style = TextStyle(
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    ),
                )
            }
            Spacer(Modifier.height(14.dp))

            // ── Stacked-area plot ──
            Canvas(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(170.dp),
            ) {
                val w = size.width
                val h = size.height
                val n = months.size

                val maxTotal = months.maxOfOrNull { it.total } ?: 0.0
                val yMax = (maxOf(maxTotal, threshold) * 1.15).coerceAtLeast(1.0)
                fun sy(v: Double): Float = (h * (1.0 - v / yMax)).toFloat()

                // X positions: d3 scalePoint with 0.25 padding.
                val xs = FloatArray(n)
                if (n == 1) {
                    xs[0] = w / 2f
                } else {
                    val step = w / (n - 1 + 0.5f)
                    val start = step * 0.25f
                    for (i in 0 until n) xs[i] = start + step * i
                }

                // Subtle horizontal grid lines (3).
                for (g in 1..3) {
                    val gy = h * g / 4f
                    drawLine(gridColor, Offset(0f, gy), Offset(w, gy), strokeWidth = 1f)
                }

                // Stack categories bottom→up; draw a smooth gradient band each.
                val baseline = DoubleArray(n)   // running cumulative per month
                categoryNames.forEachIndexed { ci, name ->
                    val y0 = ArrayList<Offset>(n + 2)
                    val y1 = ArrayList<Offset>(n + 2)
                    var anyValue = false
                    for (i in 0 until n) {
                        val v = months[i].byName[name] ?: 0.0
                        if (v > 0.0) anyValue = true
                        val bottom = baseline[i]
                        val top = bottom + v
                        y0.add(Offset(xs[i], sy(bottom)))
                        y1.add(Offset(xs[i], sy(top)))
                        baseline[i] = top
                    }
                    if (!anyValue) return@forEachIndexed
                    // Extend to both edges so the curve fills the full width.
                    y0.add(0, Offset(0f, y0.first().y)); y0.add(Offset(w, y0.last().y))
                    y1.add(0, Offset(0f, y1.first().y)); y1.add(Offset(w, y1.last().y))

                    val (c0, c1) = gradients[ci]
                    val bandTop = y1.minOf { it.y }
                    drawSmoothArea(
                        top = y1,
                        bottom = y0,
                        brush = Brush.verticalGradient(
                            colors = listOf(c0.copy(alpha = 0.95f), c1.copy(alpha = 0.75f)),
                            startY = bandTop,
                            endY = h,
                        ),
                    )
                }

                // Threshold (income or total budget) line.
                if (threshold > 0 && threshold < yMax) {
                    val ty = sy(threshold)
                    drawLine(
                        color = thresholdColor,
                        start = Offset(0f, ty),
                        end = Offset(w, ty),
                        strokeWidth = 1.5f,
                        pathEffect = PathEffect.dashPathEffect(floatArrayOf(8f, 8f)),
                    )
                }
            }

            Spacer(Modifier.height(6.dp))
            // Month labels.
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                months.forEach { m ->
                    Text(
                        text = m.label,
                        style = TextStyle(
                            fontSize = 9.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        ),
                    )
                }
            }

            Spacer(Modifier.height(12.dp))
            // Legend (latest-month spend per category).
            LazyRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                items(budgets, key = { it.id }) { budget ->
                    val (color, _) = BudgetColors.getGradient(budget.name)
                    val spent = latest?.byName?.get(budget.name) ?: 0.0
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

/**
 * Fill the region between a smooth top edge and a smooth bottom edge.
 * Both edges are drawn with a uniform Catmull-Rom spline (tension 1/6),
 * matching the React chart's `curveCatmullRom`.
 */
private fun DrawScope.drawSmoothArea(top: List<Offset>, bottom: List<Offset>, brush: Brush) {
    if (top.size < 2) return
    val path = Path()
    catmullRom(path, top, moveToStart = true)
    path.lineTo(bottom.last().x, bottom.last().y)
    catmullRom(path, bottom.asReversed(), moveToStart = false)
    path.close()
    drawPath(path = path, brush = brush)
}

private fun catmullRom(path: Path, pts: List<Offset>, moveToStart: Boolean) {
    if (pts.isEmpty()) return
    if (moveToStart) path.moveTo(pts[0].x, pts[0].y)
    for (i in 0 until pts.size - 1) {
        val p0 = pts[if (i - 1 < 0) i else i - 1]
        val p1 = pts[i]
        val p2 = pts[i + 1]
        val p3 = pts[if (i + 2 >= pts.size) i + 1 else i + 2]
        val c1x = p1.x + (p2.x - p0.x) / 6f
        val c1y = p1.y + (p2.y - p0.y) / 6f
        val c2x = p2.x - (p3.x - p1.x) / 6f
        val c2y = p2.y - (p3.y - p1.y) / 6f
        path.cubicTo(c1x, c1y, c2x, c2y, p2.x, p2.y)
    }
}

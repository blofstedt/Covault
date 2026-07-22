package com.covault.app.ui.dashboard

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.covault.app.ui.theme.MonoFontFamily
import java.text.NumberFormat
import java.util.Locale

/**
 * Top-of-dashboard balance block. Direct port of
 * `components/dashboard_components/DashboardBalanceSection.tsx`.
 *
 *  - "Remaining Balance" / "Our Remaining Balance" label
 *  - Big monospace number (emerald if positive, rose if negative)
 *  - Search button (toggles into a search field)
 *  - Settings cog on the right
 *  - "Set monthly income" hint when income is 0
 */
@Composable
fun DashboardBalanceSection(
    isSharedAccount: Boolean,
    remainingMoney: Double,
    monthlyIncome: Double,
    searchQuery: String,
    isSearchOpen: Boolean,
    onSearchQueryChange: (String) -> Unit,
    onSearchOpenChange: (Boolean) -> Unit,
    onOpenSettings: () -> Unit,
) {
    val isNegative = remainingMoney < 0
    val hasNoIncome = monthlyIncome == 0.0
    val isDark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    // Solid emerald / rose, matching React's `text-emerald-500 dark:text-emerald-400`
    // (and the rose equivalents) — not a gradient.
    val figureColor = when {
        isNegative && isDark -> Color(0xFFFB7185) // rose-400
        isNegative -> Color(0xFFF43F5E)           // rose-500
        isDark -> Color(0xFF34D399)               // emerald-400
        else -> Color(0xFF10B981)                 // emerald-500
    }
    // Mirror JS `Number.toLocaleString()` (en-US): thousands grouping, sign kept,
    // up to 3 fraction digits — e.g. -5591.4 -> "-5,591.4".
    val formatted = remember(remainingMoney) {
        NumberFormat.getNumberInstance(Locale.US).apply { maximumFractionDigits = 3 }
            .format(remainingMoney)
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 12.dp, bottom = 4.dp)
            .windowInsetsPadding(WindowInsets.statusBars),
    ) {
        // Soft glow behind the balance number
        Box(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .padding(top = 28.dp)
                .size(width = 144.dp, height = 64.dp)
                .blur(48.dp)
                .background(
                    color = if (isNegative) Color(0xFFfb7185).copy(alpha = 0.2f)
                            else Color(0xFF34d399).copy(alpha = 0.2f),
                    shape = RoundedCornerShape(50),
                ),
        )

        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // Top row: label + settings cog
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Spacer(Modifier.weight(1f))
                Text(
                    text = if (isSharedAccount) "Our Remaining Balance" else "Remaining Balance",
                    style = TextStyle(
                        fontSize = 10.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    ),
                    textAlign = TextAlign.Center,
                    letterSpacing = 2.sp,
                )
                Spacer(Modifier.weight(1f))
                IconButton(
                    onClick = onOpenSettings,
                    modifier = Modifier
                        .size(36.dp)
                        .background(
                            color = MaterialTheme.colorScheme.surface.copy(alpha = 0.6f),
                            shape = RoundedCornerShape(12.dp),
                        )
                        .border(
                            width = 1.dp,
                            color = MaterialTheme.colorScheme.outlineVariant,
                            shape = RoundedCornerShape(12.dp),
                        ),
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Settings,
                        contentDescription = "Settings",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }

            if (hasNoIncome) {
                Text(
                    text = "Set monthly income in Settings →",
                    style = TextStyle(
                        fontSize = 10.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    ),
                    modifier = Modifier
                        .clickable(onClick = onOpenSettings)
                        .padding(vertical = 4.dp),
                )
            }

            Row(
                verticalAlignment = Alignment.Bottom,
                horizontalArrangement = Arrangement.Center,
                modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
            ) {
                Text(
                    text = "$",
                    style = TextStyle(
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold,
                        color = figureColor,
                    ),
                )
                Spacer(Modifier.size(4.dp))
                Text(
                    text = formatted,
                    style = TextStyle(
                        fontSize = 36.sp,
                        fontWeight = FontWeight.ExtraBold,
                        fontFamily = MonoFontFamily,
                        color = figureColor,
                        letterSpacing = (-1.5).sp, // tracking-tighter
                    ),
                )
            }

            Spacer(Modifier.height(8.dp))

            // Search button / field
            if (isSearchOpen) {
                SearchField(
                    query = searchQuery,
                    onQueryChange = onSearchQueryChange,
                )
            } else {
                SearchButton(onClick = { onSearchOpenChange(true) })
            }
        }
    }
}

@Composable
private fun SearchButton(onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .clickable(onClick = onClick)
            .background(
                color = MaterialTheme.colorScheme.surface.copy(alpha = 0.7f),
                shape = RoundedCornerShape(20.dp),
            )
            .border(
                width = 1.dp,
                color = MaterialTheme.colorScheme.outlineVariant,
                shape = RoundedCornerShape(20.dp),
            )
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(
            imageVector = Icons.Outlined.Search,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(14.dp),
        )
        Text(
            text = "Find entry...",
            style = TextStyle(
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            ),
        )
    }
}

@Composable
private fun SearchField(
    query: String,
    onQueryChange: (String) -> Unit,
) {
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    Row(
        modifier = Modifier
            .background(
                color = MaterialTheme.colorScheme.surface.copy(alpha = 0.8f),
                shape = RoundedCornerShape(20.dp),
            )
            .border(
                width = 1.dp,
                color = MaterialTheme.colorScheme.outlineVariant,
                shape = RoundedCornerShape(20.dp),
            )
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = Icons.Outlined.Search,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(14.dp),
        )
        Spacer(Modifier.size(8.dp))
        BasicTextField(
            value = query,
            onValueChange = onQueryChange,
            textStyle = TextStyle(
                color = MaterialTheme.colorScheme.onBackground,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
            ),
            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            singleLine = true,
            modifier = Modifier
                .focusRequester(focus)
                .fillMaxWidth(),
            decorationBox = { inner ->
                Box(contentAlignment = Alignment.CenterStart) {
                    if (query.isEmpty()) {
                        Text(
                            text = "Find entry...",
                            style = TextStyle(
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                fontSize = 13.sp,
                            ),
                        )
                    }
                    inner()
                }
            },
        )
    }
}

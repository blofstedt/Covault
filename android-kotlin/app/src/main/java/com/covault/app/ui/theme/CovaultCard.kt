package com.covault.app.ui.theme

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Accent color families for cards — mirrors `CardWrapper.tsx`'s `borderMap`.
 */
enum class CardAccent { Slate, Emerald, Blue, Violet, Amber, Red }

/**
 * Shared card surface capturing the React card look: large rounding,
 * a `surface` fill, a 1dp colored border, a subtle inset white-alpha ring
 * highlight (`ring-1 ring-inset ring-white/…`) and a soft shadow.
 *
 * Ported from `components/shared/CardWrapper.tsx` + `components/ui/SettingsCard.tsx`.
 */
@Composable
fun CovaultCard(
    modifier: Modifier = Modifier,
    accent: CardAccent = CardAccent.Slate,
    cornerRadius: Dp = 28.dp,
    fill: Color = MaterialTheme.colorScheme.surface,
    elevation: Dp = 10.dp,
    contentPadding: PaddingValues = PaddingValues(24.dp),
    content: @Composable ColumnScope.() -> Unit,
) {
    val isDark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val shape = RoundedCornerShape(cornerRadius)
    val border = accent.borderColor(isDark)
    val ring = if (isDark) Color.White.copy(alpha = 0.04f) else Color.White.copy(alpha = 0.5f)

    Column(
        modifier = modifier
            .shadow(elevation, shape, clip = false)
            .clip(shape)
            .background(fill)
            .border(1.dp, border, shape)
            .drawWithContent {
                drawContent()
                // Inset ring highlight, 1dp in from the edge.
                val inset = 1.5.dp.toPx()
                val r = (cornerRadius.toPx() - inset).coerceAtLeast(0f)
                drawRoundRect(
                    color = ring,
                    topLeft = Offset(inset, inset),
                    size = Size(size.width - inset * 2, size.height - inset * 2),
                    cornerRadius = CornerRadius(r, r),
                    style = Stroke(width = 1.dp.toPx()),
                )
            }
            .padding(contentPadding),
        content = content,
    )
}

private fun CardAccent.borderColor(isDark: Boolean): Color = when (this) {
    CardAccent.Slate -> if (isDark) Color(0xFF1E293B).copy(alpha = 0.6f) else Color(0xFFF1F5F9)
    CardAccent.Emerald -> if (isDark) Color(0xFF065F46).copy(alpha = 0.4f) else Color(0xFFA7F3D0)
    CardAccent.Blue -> if (isDark) Color(0xFF1E40AF).copy(alpha = 0.4f) else Color(0xFFBFDBFE)
    CardAccent.Violet -> if (isDark) Color(0xFF5B21B6).copy(alpha = 0.4f) else Color(0xFFDDD6FE)
    CardAccent.Amber -> if (isDark) Color(0xFF92400E).copy(alpha = 0.4f) else Color(0xFFFDE68A)
    CardAccent.Red -> if (isDark) Color(0xFF1E293B).copy(alpha = 0.6f) else Color(0xFFF1F5F9)
}

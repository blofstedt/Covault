package com.covault.app.ui.theme

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance

/**
 * Ambient page background — port of `components/ui/PageShell.tsx`.
 *
 * React drew two soft radial emerald glows near the top of every screen over
 * a slate-50/slate-950 base. The Kotlin screens were flat; this restores the
 * subtle top-of-screen glow that gives the app depth. Kept cheap: two static
 * [Brush.radialGradient] layers in a single [drawBehind], no animation.
 */
@Composable
fun CovaultBackground(
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit,
) {
    val base = MaterialTheme.colorScheme.background
    val isDark = base.luminance() < 0.5f

    // Matches PageShell's --glow-* custom properties.
    val glow1 = if (isDark) Color(0xFF10B981).copy(alpha = 0.18f)   // emerald-500
    else Color(0xFF34D399).copy(alpha = 0.12f)                       // emerald-400
    val glow2 = if (isDark) Color(0xFF4ADE80).copy(alpha = 0.12f)   // green-400
    else Color(0xFF86EFAC).copy(alpha = 0.08f)                       // green-300

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(base)
            .drawBehind {
                val w = size.width
                val h = size.height
                // Glow 1 — left of center, bleeding in from the top edge.
                drawRect(
                    brush = Brush.radialGradient(
                        colors = listOf(glow1, glow1.copy(alpha = glow1.alpha * 0.3f), Color.Transparent),
                        center = Offset(w * 0.30f, -h * 0.10f),
                        radius = w * 0.95f,
                    ),
                )
                // Glow 2 — right side, slightly smaller.
                drawRect(
                    brush = Brush.radialGradient(
                        colors = listOf(glow2, glow2.copy(alpha = glow2.alpha * 0.3f), Color.Transparent),
                        center = Offset(w * 0.75f, -h * 0.10f),
                        radius = w * 0.85f,
                    ),
                )
            },
        content = content,
    )
}

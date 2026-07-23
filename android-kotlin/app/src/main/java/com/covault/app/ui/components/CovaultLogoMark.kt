package com.covault.app.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.covault.app.ui.theme.CovaultTheme

/**
 * The Covault brand mark — a vault door with a center slot. Procedurally
 * drawn so we don't need to ship a raster icon. Stage 4 will tune the
 * proportions to match the React `components/CovaultIcon.tsx` glyph
 * exactly; for Stage 3 this is a faithful placeholder.
 *
 * Reusable: passed a `size` so the auth screen can show it large and
 * the dashboard can use a smaller version in headers.
 */
@Composable
fun CovaultLogoMark(
    size: Dp = 96.dp,
    primary: Color = Color(0xFF5b9e97),   // matches the muted teal of the
    secondary: Color = Color(0xFF9a7bbf), // budget palette
    modifier: Modifier = Modifier,
) {
    Canvas(modifier = modifier.size(size)) {
        val w = this.size.width
        val h = this.size.height
        val doorRadius = w * 0.42f

        // Outer ring (the vault wheel)
        drawCircle(
            color = primary.copy(alpha = 0.25f),
            radius = w * 0.45f,
            center = Offset(w / 2, h / 2),
        )
        drawCircle(
            color = primary,
            radius = w * 0.40f,
            center = Offset(w / 2, h / 2),
            style = Stroke(width = w * 0.025f),
        )

        // Vault door body
        val doorSize = Size(doorRadius * 2, doorRadius * 2)
        val doorTopLeft = Offset(w / 2 - doorRadius, h / 2 - doorRadius)
        drawCircle(
            brush = Brush.radialGradient(
                colors = listOf(primary.copy(alpha = 0.3f), primary.copy(alpha = 0.1f)),
                center = Offset(w / 2, h / 2),
                radius = doorRadius,
            ),
            radius = doorRadius,
            center = Offset(w / 2, h / 2),
        )

        // Center slot
        val slotWidth = w * 0.10f
        val slotHeight = h * 0.40f
        drawRoundRect(
            color = secondary,
            topLeft = Offset(w / 2 - slotWidth / 2, h / 2 - slotHeight / 2),
            size = Size(slotWidth, slotHeight),
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(slotWidth / 2, slotWidth / 2),
        )

        // Spokes (4 crosshair lines on the wheel)
        val spokeInset = w * 0.08f
        val spokeStroke = w * 0.020f
        val cx = w / 2
        val cy = h / 2
        val r = w * 0.40f
        // top
        drawLine(
            color = primary,
            start = Offset(cx, cy - r + spokeInset),
            end = Offset(cx, cy - r / 2),
            strokeWidth = spokeStroke,
        )
        // bottom
        drawLine(
            color = primary,
            start = Offset(cx, cy + r / 2),
            end = Offset(cx, cy + r - spokeInset),
            strokeWidth = spokeStroke,
        )
        // left
        drawLine(
            color = primary,
            start = Offset(cx - r + spokeInset, cy),
            end = Offset(cx - r / 2, cy),
            strokeWidth = spokeStroke,
        )
        // right
        drawLine(
            color = primary,
            start = Offset(cx + r / 2, cy),
            end = Offset(cx + r - spokeInset, cy),
            strokeWidth = spokeStroke,
        )
    }
}

@Preview
@Composable
private fun CovaultLogoMarkPreview() {
    CovaultTheme {
        CovaultLogoMark(size = 120.dp)
    }
}

package com.covault.app.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.covault.app.ui.theme.CovaultTheme

/**
 * The Covault brand mark — a 1:1 Compose port of the React
 * `components/CovaultIcon.tsx`: an emerald rounded square, tilted 12°,
 * with a white "vault dial" glyph (rounded frame + centre circle + four
 * ticks + a handle line) drawn upright inside it.
 *
 * Reusable at any [size]; the auth screen shows it large, headers small.
 */
@Composable
fun CovaultLogoMark(
    size: Dp = 96.dp,
    modifier: Modifier = Modifier,
    rotate: Boolean = true,
) {
    val emerald = Color(0xFF059669)          // emerald-600
    val corner = RoundedCornerShape(size * 0.34f)
    Box(
        modifier = modifier
            .size(size)
            .then(if (rotate) Modifier.rotate(12f) else Modifier)
            .shadow(elevation = size * 0.10f, shape = corner, spotColor = emerald, ambientColor = emerald)
            .clip(corner)
            .background(emerald),
        contentAlignment = Alignment.Center,
    ) {
        Canvas(
            modifier = Modifier
                .size(size * 0.52f)
                .then(if (rotate) Modifier.rotate(-12f) else Modifier),
        ) {
            val u = this.size.width / 24f     // viewBox is 24 units, like the SVG
            val stroke = Stroke(width = 2.3f * u, cap = StrokeCap.Round)
            val white = Color.White
            // Rounded frame: rect x3 y3 w18 h18 rx2
            drawRoundRect(
                color = white,
                topLeft = Offset(3f * u, 3f * u),
                size = Size(18f * u, 18f * u),
                cornerRadius = CornerRadius(2f * u, 2f * u),
                style = stroke,
            )
            // Centre dial: circle r4
            drawCircle(color = white, radius = 4f * u, center = Offset(12f * u, 12f * u), style = stroke)
            // Four ticks + handle line
            fun seg(x1: Float, y1: Float, x2: Float, y2: Float) = drawLine(
                white, Offset(x1 * u, y1 * u), Offset(x2 * u, y2 * u),
                strokeWidth = 2.3f * u, cap = StrokeCap.Round,
            )
            seg(12f, 8f, 12f, 9f)    // top
            seg(12f, 15f, 12f, 16f)  // bottom
            seg(8f, 12f, 9f, 12f)    // left
            seg(15f, 12f, 16f, 12f)  // right
            seg(12f, 12f, 14f, 14f)  // handle
        }
    }
}

@Preview
@Composable
private fun CovaultLogoMarkPreview() {
    CovaultTheme {
        CovaultLogoMark(size = 120.dp)
    }
}

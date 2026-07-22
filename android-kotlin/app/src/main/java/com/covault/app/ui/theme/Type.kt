package com.covault.app.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import com.covault.app.R

/**
 * Typography ported from the React/Tailwind design language.
 *
 * React used **Inter** for all UI text and **JetBrains Mono** for numeric
 * displays (the balance figure, budget amounts). The Kotlin app previously
 * fell back to system Roboto, which was the single biggest reason the app
 * "felt different" from the React original.
 *
 * Inter ships as a single variable font (`inter_variable.ttf`, wght axis
 * Thin→Black). On API 26+ (our minSdk) Compose derives each weight from the
 * `FontWeight` passed to [Font] via the font's `wght` variation axis, so one
 * file covers every weight we need.
 */

val InterFontFamily = FontFamily(
    Font(R.font.inter_variable, FontWeight.Normal),
    Font(R.font.inter_variable, FontWeight.Medium),
    Font(R.font.inter_variable, FontWeight.SemiBold),
    Font(R.font.inter_variable, FontWeight.Bold),
    Font(R.font.inter_variable, FontWeight.ExtraBold),
)

/** Monospace family for numeric figures (balance, amounts) — mirrors `font-mono`. */
val MonoFontFamily = FontFamily(
    Font(R.font.jetbrains_mono_medium, FontWeight.Medium),
    Font(R.font.jetbrains_mono_bold, FontWeight.Bold),
)

/**
 * Material 3 [Typography] with Inter as the default family across every style
 * and weights nudged toward the React look (bold/extrabold headings,
 * semibold labels). We start from the M3 defaults (good sizes/line-heights)
 * and only swap the family + a few weights, so nothing else regresses.
 */
val CovaultTypography: Typography = Typography().run {
    fun TextStyle.inter(weight: FontWeight? = null) =
        copy(fontFamily = InterFontFamily, fontWeight = weight ?: fontWeight)

    Typography(
        displayLarge = displayLarge.inter(FontWeight.ExtraBold),
        displayMedium = displayMedium.inter(FontWeight.ExtraBold),
        displaySmall = displaySmall.inter(FontWeight.Bold),
        headlineLarge = headlineLarge.inter(FontWeight.ExtraBold),
        headlineMedium = headlineMedium.inter(FontWeight.Bold),
        headlineSmall = headlineSmall.inter(FontWeight.Bold),
        titleLarge = titleLarge.inter(FontWeight.Bold),
        titleMedium = titleMedium.inter(FontWeight.SemiBold),
        titleSmall = titleSmall.inter(FontWeight.SemiBold),
        bodyLarge = bodyLarge.inter(),
        bodyMedium = bodyMedium.inter(),
        bodySmall = bodySmall.inter(),
        labelLarge = labelLarge.inter(FontWeight.SemiBold),
        labelMedium = labelMedium.inter(FontWeight.SemiBold),
        labelSmall = labelSmall.inter(FontWeight.SemiBold),
    )
}

package com.covault.app.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

/**
 * Brand palette mapped 1:1 from the React/Tailwind design language:
 * emerald accent on slate neutrals (NOT Material's default purple, and
 * NOT wallpaper-based dynamic color). `tertiary` is the blue used by the
 * login's background glow; `error` is Tailwind rose.
 */
private val LightColors = lightColorScheme(
    primary = Color(0xFF059669),          // emerald-600
    onPrimary = Color.White,
    primaryContainer = Color(0xFFD1FAE5), // emerald-100
    onPrimaryContainer = Color(0xFF064E3B),
    secondary = Color(0xFF0D9488),        // teal-600
    onSecondary = Color.White,
    tertiary = Color(0xFF3B82F6),         // blue-500 (login glow)
    onTertiary = Color.White,
    background = Color(0xFFF8FAFC),       // slate-50
    onBackground = Color(0xFF1E293B),     // slate-800
    surface = Color(0xFFFFFFFF),          // white cards / Google button
    onSurface = Color(0xFF334155),        // slate-700
    surfaceVariant = Color(0xFFF1F5F9),   // slate-100
    onSurfaceVariant = Color(0xFF94A3B8), // slate-400 (muted labels)
    outline = Color(0xFFCBD5E1),          // slate-300
    outlineVariant = Color(0xFFE2E8F0),   // slate-200 (button border)
    error = Color(0xFFE11D48),            // rose-600
    onError = Color.White,
    errorContainer = Color(0xFFFFE4E6),   // rose-100
    onErrorContainer = Color(0xFF9F1239), // rose-800
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF10B981),          // emerald-500
    onPrimary = Color(0xFF052E16),        // emerald-950
    primaryContainer = Color(0xFF065F46), // emerald-800
    onPrimaryContainer = Color(0xFFD1FAE5),
    secondary = Color(0xFF2DD4BF),        // teal-400
    onSecondary = Color(0xFF042F2E),
    tertiary = Color(0xFF60A5FA),         // blue-400 (login glow)
    onTertiary = Color(0xFF0B1220),
    background = Color(0xFF020617),       // slate-950
    onBackground = Color(0xFFF1F5F9),     // slate-100
    surface = Color(0xFF0F172A),          // slate-900 cards
    onSurface = Color(0xFFF1F5F9),        // slate-100
    surfaceVariant = Color(0xFF1E293B),   // slate-800
    onSurfaceVariant = Color(0xFF94A3B8), // slate-400 (muted labels)
    outline = Color(0xFF334155),          // slate-700
    outlineVariant = Color(0xFF1E293B),   // slate-800 (button border)
    error = Color(0xFFFB7185),            // rose-400
    onError = Color(0xFF4C0519),          // rose-950
    errorContainer = Color(0xFF881337),   // rose-900
    onErrorContainer = Color(0xFFFFE4E6), // rose-100
)

@Composable
fun CovaultTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    // Brand palette wins over Material You wallpaper theming by default —
    // the emerald/slate identity must be consistent on every device.
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkColors
        else -> LightColors
    }
    MaterialTheme(
        colorScheme = colorScheme,
        typography = CovaultTypography,
        content = content
    )
}

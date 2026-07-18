package com.covault.app.ui.dashboard

import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AttachMoney
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.DirectionsCar
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.LocalGroceryStore
import androidx.compose.material.icons.outlined.Mood
import androidx.compose.material.icons.outlined.PhoneIphone
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Maps a budget category name to an icon. Direct port of
 * `components/dashboard_components/getBudgetIcon.tsx`. Uses
 * Material Icons Extended so we get the same Lucide-style
 * shapes the React app uses (Home, ShoppingBag, CarFront, etc.).
 */
fun budgetIconFor(name: String): ImageVector {
    val lower = name.lowercase()
    return when {
        lower.contains("housing") -> Icons.Outlined.Home
        lower.contains("groceries") -> Icons.Outlined.LocalGroceryStore
        lower.contains("transport") -> Icons.Outlined.DirectionsCar
        lower.contains("dining") || lower.contains("leisure") -> Icons.Outlined.Mood
        lower.contains("utilities") -> Icons.Outlined.Bolt
        lower.contains("services") -> Icons.Outlined.PhoneIphone
        lower.contains("attach") || lower.contains("money") -> Icons.Outlined.AttachMoney
        lower.contains("search") -> Icons.Outlined.Search
        lower.contains("settings") -> Icons.Outlined.Settings
        lower.contains("tune") -> Icons.Outlined.Tune
        else -> Icons.Outlined.MoreHoriz
    }
}

@Composable
fun BudgetIcon(
    name: String,
    tint: Color = Color.Unspecified,
    size: Dp = 20.dp,
    modifier: Modifier = Modifier,
) {
    Icon(
        imageVector = budgetIconFor(name),
        contentDescription = name,
        tint = tint,
        modifier = modifier.size(size),
    )
}

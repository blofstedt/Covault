package com.covault.app.ui.dashboard

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Fixed bottom action bar. Direct port of
 * `components/dashboard_components/DashboardBottomBar.tsx`.
 *
 *  - Home button (filled if active)
 *  - + Add transaction button (the main emerald CTA)
 *  - Parsing button with a pending-count badge
 */
@Composable
fun DashboardBottomBar(
    onGoHome: () -> Unit,
    onAddTransaction: () -> Unit,
    onOpenReview: () -> Unit = {},
    pendingCount: Int = 0,
    activeView: String = "home",
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .windowInsetsPadding(WindowInsets.navigationBars)
            .padding(bottom = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            modifier = Modifier
                .width(280.dp)
                .shadow(elevation = 12.dp, shape = CircleShape)
                .background(
                    color = MaterialTheme.colorScheme.surface.copy(alpha = 0.9f),
                    shape = CircleShape,
                )
                .border(
                    width = 1.dp,
                    color = MaterialTheme.colorScheme.outlineVariant,
                    shape = CircleShape,
                )
                .padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceEvenly,
        ) {
            BarButton(
                icon = Icons.Outlined.Home,
                contentDescription = "Home",
                active = activeView == "home",
                onClick = onGoHome,
            )
            Divider()
            AddButton(onClick = onAddTransaction)
            Divider()
            ReviewButton(
                pendingCount = pendingCount,
                active = activeView == "review",
                onClick = onOpenReview,
            )
        }
    }
}

@Composable
private fun BarButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    contentDescription: String,
    active: Boolean,
    onClick: () -> Unit,
) {
    IconButton(onClick = onClick) {
        Icon(
            imageVector = icon,
            contentDescription = contentDescription,
            tint = if (active) MaterialTheme.colorScheme.primary
                   else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(24.dp),
        )
    }
}

@Composable
private fun Divider() {
    Box(
        modifier = Modifier
            .width(1.dp)
            .height(24.dp)
            .background(color = MaterialTheme.colorScheme.outlineVariant),
    )
}

@Composable
private fun AddButton(onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .size(40.dp)
            .shadow(elevation = 8.dp, shape = CircleShape)
            .background(color = MaterialTheme.colorScheme.primary, shape = CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        IconButton(onClick = onClick) {
            Icon(
                imageVector = Icons.Outlined.Add,
                contentDescription = "Add transaction",
                tint = MaterialTheme.colorScheme.onPrimary,
                modifier = Modifier.size(20.dp),
            )
        }
    }
}

@Composable
private fun ReviewButton(
    pendingCount: Int,
    active: Boolean,
    onClick: () -> Unit,
) {
    Box {
        IconButton(onClick = onClick) {
            Icon(
                imageVector = Icons.Outlined.Inbox,
                contentDescription = "Review captured transactions",
                tint = if (active) MaterialTheme.colorScheme.primary
                       else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(24.dp),
            )
        }
        if (pendingCount > 0) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .size(18.dp)
                    .background(color = Color(0xFFF59E0B), shape = CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = if (pendingCount > 99) "99+" else pendingCount.toString(),
                    style = TextStyle(
                        fontSize = 9.sp,
                        fontWeight = FontWeight.Black,
                        color = Color.White,
                    ),
                )
            }
        }
    }
}


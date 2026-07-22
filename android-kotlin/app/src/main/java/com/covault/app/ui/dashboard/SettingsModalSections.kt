package com.covault.app.ui.dashboard

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.ui.platform.LocalContext
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.covault.app.data.repository.ThemePreference
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.covault.app.data.model.BudgetCategory
import com.covault.app.data.model.Transaction
import com.covault.app.data.model.User
import com.covault.app.domain.CsvExport
import com.covault.app.domain.CsvImport

// =============================================================================
// Settings modal sections. Direct port of `DashboardSettingsModal.tsx` and
// its 14 sub-components in `settings_modal_components/`.
//
// In the React app, each section is its own file. In Kotlin we keep them
// as private composables in this single file because they're tiny (most
// are 20-40 lines) and the settings modal is the only place that uses
// them. The public surface is the `DashboardSettingsModal` composable
// at the bottom of this file.
// =============================================================================

data class DashboardSettingsCallbacks(
    val onUpdateUserIncome: (Double) -> Unit,
    val onSaveBudgetLimit: (String, Double) -> Unit,
    val onChangePartnerEmail: (String) -> Unit,
    val onConnectPartner: () -> Unit,
    val onDisconnectPartner: () -> Unit,
    val onSetLinking: (Boolean) -> Unit,
    val onSignOut: () -> Unit,
)

// ---- Shared building blocks ----------------------------------------------

@Composable
internal fun SettingsCard(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(24.dp),
        modifier = modifier
            .fillMaxWidth()
            .border(
                width = 1.dp,
                color = MaterialTheme.colorScheme.outlineVariant,
                shape = RoundedCornerShape(24.dp),
            ),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            content()
        }
    }
}

@Composable
internal fun SectionHeader(title: String, subtitle: String, modifier: Modifier = Modifier) {
    Column(modifier = modifier) {
        Text(
            text = title,
            style = TextStyle(
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface,
            ),
        )
        Spacer(Modifier.height(2.dp))
        Text(
            text = subtitle,
            style = TextStyle(
                fontSize = 11.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            ),
        )
    }
}
// ---- 1. Frequently Asked ------------------------------------------------

@Composable
private fun FAQButton(onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(
            text = "Frequently Asked",
            style = TextStyle(
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            ),
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 16.dp),
        )
    }
}

@Composable
private fun LearnedRulesButton(onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(
            text = "Learned Rules",
            style = TextStyle(
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            ),
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 16.dp),
        )
    }
}

@Composable
private fun LegalLinks(onShowPrivacy: () -> Unit, onShowTerms: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = "Privacy Policy",
            style = TextStyle(
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.primary,
            ),
            modifier = Modifier.clickable(onClick = onShowPrivacy).padding(8.dp),
        )
        Text(
            text = "·",
            style = TextStyle(fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant),
        )
        Text(
            text = "Terms of Service",
            style = TextStyle(
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.primary,
            ),
            modifier = Modifier.clickable(onClick = onShowTerms).padding(8.dp),
        )
    }
}

// ---- Bank Notification Listener ------------------------------------------

/** Whether Covault currently holds Android's "Notification access" permission. */
private fun isNotificationAccessGranted(context: Context): Boolean {
    val flat = Settings.Secure.getString(
        context.contentResolver, "enabled_notification_listeners",
    )
    return !flat.isNullOrEmpty() &&
        flat.split(":").any { it.startsWith(context.packageName + "/") }
}

/**
 * Port of the React `NotificationSettingsSection`: shows whether notification
 * access is granted and links out to the system settings page to grant/manage
 * it. Auto-refreshes on resume so the pill flips to green when the user comes
 * back from Settings. (The banking-app picker in the React version needs a
 * native package query and is not ported here.)
 */
@Composable
private fun NotificationListenerSection() {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var granted by remember { mutableStateOf(isNotificationAccessGranted(context)) }
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                granted = isNotificationAccessGranted(context)
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    SettingsCard {
        SectionHeader(
            title = "Bank Notification Listener",
            subtitle = "Auto-log transactions from supported banking apps.",
            modifier = Modifier.padding(bottom = 12.dp),
        )
        // Status pill
        val pillColor = if (granted) MaterialTheme.colorScheme.primary else Color(0xFFF59E0B)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .background(color = pillColor, shape = RoundedCornerShape(50)),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                text = if (granted) "Active — auto-logging transactions"
                else "Permission not granted in system settings",
                style = TextStyle(
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = pillColor,
                ),
            )
        }
        Spacer(Modifier.height(12.dp))
        Surface(
            onClick = {
                runCatching {
                    context.startActivity(
                        Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    )
                }
            },
            color = MaterialTheme.colorScheme.primary.copy(alpha = 0.08f),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(
                text = if (granted) "Manage notification access" else "Grant notification access →",
                style = TextStyle(
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.primary,
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 8.dp),
            )
        }
        if (!granted) {
            Spacer(Modifier.height(10.dp))
            Text(
                text = "One-time setup: tap above, find Covault under " +
                    "Settings › Apps › Special app access › Notification access, " +
                    "and toggle it on. Return here — the status turns green automatically.",
                style = TextStyle(
                    fontSize = 10.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                ),
            )
        }
    }
}

// ---- 2. Income -----------------------------------------------------------

@Composable
private fun IncomeSection(
    isSharedAccount: Boolean,
    user: User?,
    onUpdate: (Double) -> Unit,
) {
    var inputValue by remember { mutableStateOf(user?.monthlyIncome?.toString().orEmpty()) }
    LaunchedEffect(user?.monthlyIncome) {
        inputValue = (user?.monthlyIncome ?: 0.0).toString()
    }
    SettingsCard {
        SectionHeader(
            title = if (isSharedAccount) "My Monthly Income" else "Monthly Income",
            subtitle = if (isSharedAccount)
                "Your income contribution. Your partner's income will be added automatically."
            else "This defines your total cash flow for the month.",
            modifier = Modifier.padding(bottom = 12.dp),
        )
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(
                    color = MaterialTheme.colorScheme.background,
                    shape = RoundedCornerShape(20.dp),
                )
                .border(
                    width = 1.dp,
                    color = MaterialTheme.colorScheme.outlineVariant,
                    shape = RoundedCornerShape(20.dp),
                )
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "$",
                style = TextStyle(
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Black,
                    color = MaterialTheme.colorScheme.outline,
                ),
            )
            Spacer(Modifier.width(8.dp))
            BasicTextField(
                value = inputValue,
                onValueChange = { inputValue = it.filter { ch -> ch.isDigit() || ch == '.' } },
                textStyle = TextStyle(
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Black,
                    color = MaterialTheme.colorScheme.onSurface,
                ),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                singleLine = true,
                modifier = Modifier.weight(1f),
                decorationBox = { inner ->
                    Box {
                        if (inputValue.isEmpty()) {
                            Text(
                                text = "0",
                                style = TextStyle(
                                    fontSize = 16.sp,
                                    fontWeight = FontWeight.Black,
                                    color = MaterialTheme.colorScheme.outline,
                                ),
                            )
                        }
                        inner()
                    }
                },
            )
        }
        Spacer(Modifier.height(8.dp))
        Surface(
            onClick = {
                val v = inputValue.toDoubleOrNull()
                if (v != null && v >= 0) onUpdate(v)
            },
            color = MaterialTheme.colorScheme.primary.copy(alpha = 0.08f),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(
                text = "Save income",
                style = TextStyle(
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.primary,
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 8.dp),
            )
        }
    }
}

// ---- 3. Budget Limits ----------------------------------------------------

@Composable
private fun BudgetLimitsSection(
    budgets: List<BudgetCategory>,
    onSaveLimit: (String, Double) -> Unit,
) {
    SettingsCard {
        SectionHeader(
            title = "Budget Limits",
            subtitle = "Adjust how much you allocate to each category.",
            modifier = Modifier.padding(bottom = 12.dp),
        )
        budgets.forEach { b ->
            var editing by remember { mutableStateOf(false) }
            var text by remember(b.totalLimit) { mutableStateOf(b.totalLimit.toInt().toString()) }
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                BudgetIcon(
                    name = b.name,
                    tint = MaterialTheme.colorScheme.onSurface,
                    size = 20.dp,
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    text = b.name,
                    style = TextStyle(
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface,
                    ),
                    modifier = Modifier.weight(1f),
                )
                if (editing) {
                    BasicTextField(
                        value = text,
                        onValueChange = { text = it.filter { ch -> ch.isDigit() } },
                        textStyle = TextStyle(
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Black,
                            color = MaterialTheme.colorScheme.onSurface,
                        ),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                        singleLine = true,
                        modifier = Modifier
                            .width(80.dp)
                            .background(
                                color = MaterialTheme.colorScheme.surfaceVariant,
                                shape = RoundedCornerShape(8.dp),
                            )
                            .padding(horizontal = 8.dp, vertical = 4.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        text = "Save",
                        style = TextStyle(
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.primary,
                        ),
                        modifier = Modifier.clickable {
                            val v = text.toDoubleOrNull()
                            if (v != null) {
                                onSaveLimit(b.id, v)
                                editing = false
                            }
                        },
                    )
                } else {
                    Text(
                        text = "$${b.totalLimit.toInt()}",
                        style = TextStyle(
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Black,
                            color = MaterialTheme.colorScheme.onSurface,
                        ),
                        modifier = Modifier.clickable { editing = true },
                    )
                }
            }
        }
    }
}
@Composable
private fun PremiumBadge() {
    Box(
        modifier = Modifier
            .background(
                color = MaterialTheme.colorScheme.tertiaryContainer,
                shape = RoundedCornerShape(8.dp),
            )
            .padding(horizontal = 6.dp, vertical = 2.dp),
    ) {
        Text(
            text = "Premium",
            style = TextStyle(
                fontSize = 9.sp,
                fontWeight = FontWeight.Black,
                color = MaterialTheme.colorScheme.onTertiaryContainer,
            ),
        )
    }
}
// ---- 9. Vault sharing (partner linking) ---------------------------------

@Composable
private fun VaultSharingSection(
    user: User?,
    isLinkingPartner: Boolean,
    partnerLinkEmail: String,
    onChangeEmail: (String) -> Unit,
    onConnect: () -> Unit,
    onDisconnect: () -> Unit,
) {
    SettingsCard {
        SectionHeader(
            title = "Vault Sharing",
            subtitle = if (user?.hasJointAccounts == true)
                "Linked with ${user.partnerEmail ?: user.partnerName ?: "partner"}."
            else "Invite your partner to share this vault.",
            modifier = Modifier.padding(bottom = 8.dp),
        )
        if (user?.hasJointAccounts == true) {
            Surface(
                onClick = onDisconnect,
                color = MaterialTheme.colorScheme.errorContainer,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    text = "Disconnect",
                    style = TextStyle(
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onErrorContainer,
                    ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 10.dp),
                )
            }
        } else {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                BasicTextField(
                    value = partnerLinkEmail,
                    onValueChange = onChangeEmail,
                    textStyle = TextStyle(
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurface,
                    ),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                    singleLine = true,
                    modifier = Modifier
                        .weight(1f)
                        .background(
                            color = MaterialTheme.colorScheme.background,
                            shape = RoundedCornerShape(12.dp),
                        )
                        .border(
                            width = 1.dp,
                            color = MaterialTheme.colorScheme.outlineVariant,
                            shape = RoundedCornerShape(12.dp),
                        )
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    decorationBox = { inner ->
                        Box {
                            if (partnerLinkEmail.isEmpty()) {
                                Text(
                                    text = "partner@example.com",
                                    style = TextStyle(
                                        fontSize = 13.sp,
                                        color = MaterialTheme.colorScheme.outline,
                                    ),
                                )
                            }
                            inner()
                        }
                    },
                )
                Spacer(Modifier.width(8.dp))
                Surface(
                    onClick = onConnect,
                    color = MaterialTheme.colorScheme.primary,
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Text(
                        text = if (isLinkingPartner) "Linking…" else "Connect",
                        style = TextStyle(
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onPrimary,
                        ),
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                    )
                }
            }
        }
    }
}
// ---- 4. Theme -----------------------------------------------------------

@Composable
private fun ThemeToggleSection(themeViewModel: ThemeViewModel = hiltViewModel()) {
    val mode by themeViewModel.themeMode.collectAsStateWithLifecycle()
    val isDark = mode == ThemePreference.MODE_DARK
    SettingsCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "Dark Interface",
                    style = TextStyle(
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface,
                    ),
                )
                Text(
                    text = "Override your device's light/dark setting.",
                    style = TextStyle(
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    ),
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
            Switch(
                checked = isDark,
                onCheckedChange = { checked ->
                    themeViewModel.set(
                        if (checked) ThemePreference.MODE_DARK else ThemePreference.MODE_LIGHT,
                    )
                },
            )
        }
    }
}

// ---- 5. Discretionary Shield --------------------------------------------

@Composable
private fun DiscretionaryShieldSection(enabled: Boolean, onToggle: (Boolean) -> Unit) {
    SettingsCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "Discretionary Shield",
                    style = TextStyle(
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface,
                    ),
                )
                Text(
                    text = "Let Leisure absorb overspending from your other categories.",
                    style = TextStyle(
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    ),
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
            Switch(checked = enabled, onCheckedChange = onToggle)
        }
    }
}

// ---- 11. Export ---------------------------------------------------------

@Composable
private fun ExportSection(transactions: List<Transaction>, budgets: List<BudgetCategory>) {
    val context = LocalContext.current
    SettingsCard {
        SectionHeader(
            title = "Export",
            subtitle = "Share a CSV of your transactions.",
            modifier = Modifier.padding(bottom = 8.dp),
        )
        Surface(
            onClick = {
                val csv = CsvExport.toCsv(transactions, budgets)
                val share = Intent(Intent.ACTION_SEND).apply {
                    type = "text/csv"
                    putExtra(Intent.EXTRA_SUBJECT, "Covault transactions")
                    putExtra(Intent.EXTRA_TEXT, csv)
                }
                runCatching {
                    context.startActivity(Intent.createChooser(share, "Export CSV"))
                }
            },
            color = MaterialTheme.colorScheme.surfaceVariant,
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(
                text = "Export CSV (${transactions.size} entries)",
                style = TextStyle(
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface,
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 10.dp),
            )
        }
    }
}

@Composable
private fun ImportSection(
    budgets: List<BudgetCategory>,
    userId: String?,
    userName: String,
    onImport: (List<Transaction>) -> Unit,
) {
    val context = LocalContext.current
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null && userId != null) {
            runCatching {
                val text = context.contentResolver.openInputStream(uri)
                    ?.bufferedReader()?.use { it.readText() }.orEmpty()
                val result = CsvImport.parse(text, budgets, userId, userName)
                if (result.transactions.isNotEmpty()) onImport(result.transactions)
            }
        }
    }
    SettingsCard {
        SectionHeader(
            title = "Import",
            subtitle = "Load transactions from a CSV file.",
            modifier = Modifier.padding(bottom = 8.dp),
        )
        Surface(
            onClick = { launcher.launch("*/*") },
            color = MaterialTheme.colorScheme.surfaceVariant,
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(
                text = "Import from CSV",
                style = TextStyle(
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface,
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 10.dp),
            )
        }
    }
}

// ---- 12. Budget Report --------------------------------------------------

@Composable
private fun ReportSection(
    budgets: List<BudgetCategory>,
    transactions: List<Transaction>,
    monthlyIncome: Double,
    isSharedAccount: Boolean,
) {
    val totalSpent = transactions.filter { it.amount < 0 }.sumOf { kotlin.math.abs(it.amount) }
    SettingsCard {
        SectionHeader(
            title = "Budget Report",
            subtitle = "Snapshot of where you stand this month.",
            modifier = Modifier.padding(bottom = 8.dp),
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            StatBlock(label = "Income", value = "$${monthlyIncome.toInt()}")
            StatBlock(label = "Spent", value = "$${totalSpent.toInt()}")
            StatBlock(label = "Remaining", value = "$${(monthlyIncome - totalSpent).toInt()}")
        }
    }
}

@Composable
private fun StatBlock(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            text = value,
            style = TextStyle(
                fontSize = 16.sp,
                fontWeight = FontWeight.ExtraBold,
                color = MaterialTheme.colorScheme.onSurface,
            ),
        )
        Text(
            text = label,
            style = TextStyle(
                fontSize = 10.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            ),
        )
    }
}

// ---- 13. Support & Feedback ---------------------------------------------

@Composable
private fun SupportFeedbackSection(hasPremium: Boolean, onSubscribe: () -> Unit) {
    val context = LocalContext.current
    SettingsCard {
        SectionHeader(
            title = "Support & Feedback",
            subtitle = "Reach out for help or share an idea.",
            modifier = Modifier.padding(bottom = 8.dp),
        )
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Surface(
                onClick = {
                    runCatching {
                        context.startActivity(
                            Intent(Intent.ACTION_SENDTO).apply {
                                data = Uri.parse(
                                    "mailto:itsjustmyemail@gmail.com" +
                                        "?subject=" + Uri.encode("Covault: Problem Report"),
                                )
                            },
                        )
                    }
                },
                color = MaterialTheme.colorScheme.surfaceVariant,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.weight(1f),
            ) {
                Text(
                    text = "Email",
                    style = TextStyle(
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface,
                    ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 10.dp),
                )
            }
            Surface(
                onClick = { if (!hasPremium) onSubscribe() },
                color = MaterialTheme.colorScheme.tertiaryContainer,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.weight(1f),
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 10.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "Request a feature",
                        style = TextStyle(
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onTertiaryContainer,
                        ),
                    )
                    if (!hasPremium) {
                        Spacer(Modifier.width(6.dp))
                        PremiumBadge()
                    }
                }
            }
        }
    }
}

// ---- 14. Sign Out -------------------------------------------------------

@Composable
private fun SignOutSection(onSignOut: () -> Unit) {
    Surface(
        onClick = onSignOut,
        color = MaterialTheme.colorScheme.errorContainer,
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(
            text = "Sign out",
            style = TextStyle(
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onErrorContainer,
            ),
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 12.dp),
        )
    }
}

// =============================================================================
// Public composable: the full settings modal.
// =============================================================================

@Composable
fun DashboardSettingsModal(
    isSharedAccount: Boolean,
    user: User?,
    isLinkingPartner: Boolean,
    partnerLinkEmail: String,
    budgets: List<BudgetCategory>,
    transactions: List<Transaction>,
    callbacks: DashboardSettingsCallbacks,
    hasPremium: Boolean = true,
    onSubscribe: () -> Unit = {},
    onShowFAQ: () -> Unit = {},
    onShowLearnedRules: () -> Unit = {},
    onShowPrivacy: () -> Unit = {},
    onShowTerms: () -> Unit = {},
    onImport: (List<Transaction>) -> Unit = {},
    discretionaryShieldEnabled: Boolean = false,
    onSetDiscretionaryShield: (Boolean) -> Unit = {},
    onClose: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.scrim.copy(alpha = 0.5f)),
    ) {
        Surface(
            color = MaterialTheme.colorScheme.surface,
            shape = RoundedCornerShape(40.dp),
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = "Vault Settings",
                        style = TextStyle(
                            fontSize = 22.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurface,
                        ),
                        modifier = Modifier.weight(1f),
                    )
                    IconButton(
                        onClick = onClose,
                        modifier = Modifier
                            .size(40.dp)
                            .background(
                                color = MaterialTheme.colorScheme.surfaceVariant,
                                shape = RoundedCornerShape(50),
                            ),
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.Close,
                            contentDescription = "Close",
                            tint = MaterialTheme.colorScheme.onSurface,
                            modifier = Modifier.size(20.dp),
                        )
                    }
                }
                Spacer(Modifier.height(16.dp))

                FAQButton(onClick = onShowFAQ)
                Spacer(Modifier.height(12.dp))

                LearnedRulesButton(onClick = onShowLearnedRules)
                Spacer(Modifier.height(12.dp))

                IncomeSection(
                    isSharedAccount = isSharedAccount,
                    user = user,
                    onUpdate = callbacks.onUpdateUserIncome,
                )
                Spacer(Modifier.height(12.dp))

                BudgetLimitsSection(
                    budgets = budgets,
                    onSaveLimit = callbacks.onSaveBudgetLimit,
                )
                Spacer(Modifier.height(12.dp))

                ThemeToggleSection()
                Spacer(Modifier.height(12.dp))

                NotificationListenerSection()
                Spacer(Modifier.height(12.dp))

                DiscretionaryShieldSection(
                    enabled = discretionaryShieldEnabled,
                    onToggle = onSetDiscretionaryShield,
                )
                Spacer(Modifier.height(12.dp))

                VaultSharingSection(
                    user = user,
                    isLinkingPartner = isLinkingPartner,
                    partnerLinkEmail = partnerLinkEmail,
                    onChangeEmail = callbacks.onChangePartnerEmail,
                    onConnect = callbacks.onConnectPartner,
                    onDisconnect = callbacks.onDisconnectPartner,
                )
                Spacer(Modifier.height(12.dp))
                ExportSection(transactions = transactions, budgets = budgets)
                Spacer(Modifier.height(12.dp))
                ImportSection(
                    budgets = budgets,
                    userId = user?.id,
                    userName = user?.name.orEmpty(),
                    onImport = onImport,
                )
                Spacer(Modifier.height(12.dp))
                ReportSection(
                    budgets = budgets,
                    transactions = transactions,
                    monthlyIncome = user?.monthlyIncome ?: 0.0,
                    isSharedAccount = isSharedAccount,
                )
                Spacer(Modifier.height(12.dp))
                SupportFeedbackSection(
                    hasPremium = hasPremium,
                    onSubscribe = onSubscribe,
                )
                Spacer(Modifier.height(12.dp))
                LegalLinks(onShowPrivacy = onShowPrivacy, onShowTerms = onShowTerms)
                Spacer(Modifier.height(12.dp))
                SignOutSection(onSignOut = callbacks.onSignOut)
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "Version 3.0 · Covault",
                    style = TextStyle(
                        fontSize = 10.sp,
                        color = MaterialTheme.colorScheme.outline,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

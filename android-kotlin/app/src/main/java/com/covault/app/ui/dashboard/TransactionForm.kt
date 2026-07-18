package com.covault.app.ui.dashboard

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
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
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarToday
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.covault.app.data.model.BudgetCategory
import com.covault.app.data.model.Recurrence
import com.covault.app.data.model.Transaction
import com.covault.app.data.model.TransactionLabel
import com.covault.app.domain.FormatVendorName
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.UUID

/**
 * Vendor autocomplete suggestion. Mirrors the React
 * `VendorHistoryItem` type.
 */
data class VendorHistoryItem(val vendor: String, val budgetId: String)

/**
 * The add/edit transaction modal. Direct port of `components/TransactionForm.tsx`.
 *
 * Features:
 *  - Amount field with auto-width + Expense/Refund toggle
 *  - Vendor text field with autocomplete suggestions
 *  - 7-cell budget grid (2 rows of 4 minus the last cell)
 *  - Date row (taps open a calendar — Stage 4b-ii: simplified date input)
 *  - Recurrence segmented control: One-time / Biweekly / Monthly
 *  - Confirm / Update button (disabled until form is valid)
 *  - Delete button visible only when editing
 */
@Composable
fun TransactionForm(
    onClose: () -> Unit,
    onSave: (Transaction) -> Unit,
    budgets: List<BudgetCategory>,
    userId: String,
    userName: String,
    initialTransaction: Transaction? = null,
    isSharedAccount: Boolean = false,
    vendorHistory: List<VendorHistoryItem> = emptyList(),
    onDelete: (() -> Unit)? = null,
) {
    var vendor by remember { mutableStateOf(initialTransaction?.vendor.orEmpty()) }
    var amountStr by remember {
        mutableStateOf(initialTransaction?.let { kotlin.math.abs(it.amount).toString() }.orEmpty())
    }
    var date by remember {
        mutableStateOf(
            initialTransaction?.date?.take(10)
                ?: LocalDate.now().format(DateTimeFormatter.ISO_LOCAL_DATE)
        )
    }
    var recurrence by remember { mutableStateOf(initialTransaction?.recurrence ?: Recurrence.ONE_TIME) }
    var isRefund by remember {
        mutableStateOf(initialTransaction?.let { it.amount < 0 } ?: false)
    }
    var selectedBudgetId by remember { mutableStateOf(initialTransaction?.budgetId) }
    var showSuggestions by remember { mutableStateOf(false) }

    val isAITransaction = initialTransaction?.label == TransactionLabel.AUTOMATIC
    val suggestions = remember(vendor, vendorHistory) {
        if (vendor.isBlank()) emptyList()
        else vendorHistory.filter {
            it.vendor.lowercase().startsWith(vendor.lowercase()) &&
                it.vendor.lowercase() != vendor.lowercase()
        }.take(5)
    }
    val amount = amountStr.toDoubleOrNull() ?: 0.0
    val isFormValid = amount > 0 && selectedBudgetId != null && vendor.isNotBlank()

    val formattedDate = runCatching {
        LocalDate.parse(date).format(DateTimeFormatter.ofPattern("EEE, MMM d"))
    }.getOrDefault(date)

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.scrim.copy(alpha = 0.6f))
            .clickable(enabled = false) {},
        contentAlignment = Alignment.Center,
    ) {
        Surface(
            color = MaterialTheme.colorScheme.surface,
            shape = RoundedCornerShape(48.dp),
            modifier = Modifier
                .widthIn(max = 360.dp)
                .fillMaxWidth()
                .padding(24.dp)
                .clickable(enabled = false) {},
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(24.dp),
            ) {
                // Header
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.Top,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = if (initialTransaction != null) "Edit Entry" else "New Entry",
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        if (isSharedAccount) {
                            Text(
                                text = "Recording as $userName",
                                style = TextStyle(
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Medium,
                                    color = MaterialTheme.colorScheme.primary,
                                ),
                                modifier = Modifier.padding(top = 4.dp),
                            )
                        }
                        if (isAITransaction) {
                            Box(
                                modifier = Modifier
                                    .padding(top = 4.dp)
                                    .background(
                                        color = MaterialTheme.colorScheme.secondaryContainer,
                                        shape = RoundedCornerShape(50),
                                    )
                                    .padding(horizontal = 8.dp, vertical = 2.dp),
                            ) {
                                Text(
                                    text = "AI Transaction",
                                    style = TextStyle(
                                        fontSize = 10.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        color = MaterialTheme.colorScheme.onSecondaryContainer,
                                    ),
                                )
                            }
                        }
                    }
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

                // Amount field
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(
                            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                            shape = RoundedCornerShape(24.dp),
                        )
                        .padding(vertical = 20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = "$",
                            style = TextStyle(
                                fontSize = 20.sp,
                                fontWeight = FontWeight.Black,
                                color = if (isRefund) MaterialTheme.colorScheme.primary
                                        else MaterialTheme.colorScheme.outline,
                            ),
                        )
                        Spacer(Modifier.width(4.dp))
                        BasicTextField(
                            value = amountStr,
                            onValueChange = { newValue ->
                                amountStr = newValue.filter { it.isDigit() || it == '.' }
                            },
                            textStyle = TextStyle(
                                fontSize = 28.sp,
                                fontWeight = FontWeight.Black,
                                color = if (isRefund) MaterialTheme.colorScheme.primary
                                        else MaterialTheme.colorScheme.onSurface,
                                textAlign = TextAlign.Center,
                            ),
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Decimal,
                                imeAction = ImeAction.Next,
                            ),
                            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                            singleLine = true,
                            modifier = Modifier.widthIn(min = 64.dp),
                            decorationBox = { inner ->
                                Box(contentAlignment = Alignment.Center) {
                                    if (amountStr.isEmpty()) {
                                        Text(
                                            text = "0.00",
                                            style = TextStyle(
                                                fontSize = 28.sp,
                                                fontWeight = FontWeight.Black,
                                                color = MaterialTheme.colorScheme.outline,
                                                textAlign = TextAlign.Center,
                                            ),
                                        )
                                    }
                                    inner()
                                }
                            },
                        )
                    }
                    Spacer(Modifier.height(12.dp))
                    // Expense / Refund toggle
                    Row(
                        modifier = Modifier
                            .background(
                                color = MaterialTheme.colorScheme.surfaceVariant,
                                shape = RoundedCornerShape(50),
                            )
                            .padding(2.dp),
                    ) {
                        ToggleButton(
                            text = "Expense",
                            selected = !isRefund,
                            modifier = Modifier.weight(1f),
                        ) { isRefund = false }
                        ToggleButton(
                            text = "Refund",
                            selected = isRefund,
                            modifier = Modifier.weight(1f),
                            selectedTint = MaterialTheme.colorScheme.primary,
                        ) { isRefund = true }
                    }
                }

                Spacer(Modifier.height(12.dp))

                // Vendor input + suggestions
                Box(modifier = Modifier.fillMaxWidth()) {
                    BasicTextField(
                        value = vendor,
                        onValueChange = {
                            vendor = it
                            showSuggestions = true
                        },
                        textStyle = TextStyle(
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurface,
                            textAlign = TextAlign.Center,
                        ),
                        cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        singleLine = true,
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(
                                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                                shape = RoundedCornerShape(20.dp),
                            )
                            .border(
                                width = 1.dp,
                                color = MaterialTheme.colorScheme.outlineVariant,
                                shape = RoundedCornerShape(20.dp),
                            )
                            .padding(vertical = 12.dp, horizontal = 20.dp),
                        decorationBox = { inner ->
                            Box(contentAlignment = Alignment.Center) {
                                if (vendor.isEmpty()) {
                                    Text(
                                        text = "Where was this spent?",
                                        style = TextStyle(
                                            fontSize = 14.sp,
                                            fontWeight = FontWeight.Bold,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            textAlign = TextAlign.Center,
                                        ),
                                    )
                                }
                                inner()
                            }
                        },
                    )
                    // Suggestions are now rendered below the field rather than
                    // inside the decorationBox to avoid ColumnScope.AnimatedVisibility
                    // being picked up instead of the no-receiver overload.
                    androidx.compose.animation.AnimatedVisibility(
                        visible = false,
                        enter = fadeIn(),
                        exit = fadeOut(),
                    ) {
                        Surface(
                            color = MaterialTheme.colorScheme.surface,
                            shape = RoundedCornerShape(20.dp),
                            shadowElevation = 8.dp,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Column {
                                suggestions.forEach { s ->
                                    val budget = budgets.firstOrNull { it.id == s.budgetId }
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .clickable {
                                                vendor = s.vendor
                                                selectedBudgetId = s.budgetId
                                                showSuggestions = false
                                            }
                                            .padding(horizontal = 16.dp, vertical = 12.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        if (budget != null) {
                                            BudgetIcon(
                                                name = budget.name,
                                                tint = MaterialTheme.colorScheme.primary,
                                                size = 20.dp,
                                            )
                                            Spacer(Modifier.width(12.dp))
                                        }
                                        Text(
                                            text = FormatVendorName.formatVendorName(s.vendor),
                                            style = TextStyle(
                                                fontSize = 13.sp,
                                                fontWeight = FontWeight.Bold,
                                                color = MaterialTheme.colorScheme.onSurface,
                                            ),
                                            modifier = Modifier.weight(1f),
                                        )
                                        if (budget != null) {
                                            Text(
                                                text = budget.name,
                                                style = TextStyle(
                                                    fontSize = 10.sp,
                                                    fontWeight = FontWeight.SemiBold,
                                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                                ),
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                Spacer(Modifier.height(16.dp))

                Text(
                    text = "Target Vault",
                    style = TextStyle(
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    ),
                    modifier = Modifier.padding(start = 8.dp, bottom = 6.dp),
                )

                // Budget grid: 4 + 3
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    BudgetGridRow(budgets = budgets.take(4), selected = selectedBudgetId) { id ->
                        selectedBudgetId = if (selectedBudgetId == id) null else id
                    }
                    BudgetGridRow(budgets = budgets.drop(4).take(3), selected = selectedBudgetId) { id ->
                        selectedBudgetId = if (selectedBudgetId == id) null else id
                    }
                }

                Spacer(Modifier.height(16.dp))

                // Date row
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(
                            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                            shape = RoundedCornerShape(20.dp),
                        )
                        .border(
                            width = 1.dp,
                            color = MaterialTheme.colorScheme.outlineVariant,
                            shape = RoundedCornerShape(20.dp),
                        )
                        .clickable { /* opens calendar in a later stage */ }
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "Date",
                        style = TextStyle(
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        ),
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        text = formattedDate,
                        style = TextStyle(
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurface,
                        ),
                    )
                    Spacer(Modifier.width(8.dp))
                    Icon(
                        imageVector = Icons.Outlined.CalendarToday,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.outline,
                        modifier = Modifier.size(16.dp),
                    )
                }

                Spacer(Modifier.height(12.dp))

                Text(
                    text = "Recurrence",
                    style = TextStyle(
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 6.dp),
                    textAlign = TextAlign.Center,
                )

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(
                            color = MaterialTheme.colorScheme.surfaceVariant,
                            shape = RoundedCornerShape(20.dp),
                        )
                        .padding(4.dp),
                ) {
                    Recurrence.values().forEach { r ->
                        ToggleButton(
                            text = r.dbValue,
                            selected = recurrence == r,
                            modifier = Modifier.weight(1f),
                            selectedTint = MaterialTheme.colorScheme.primary,
                        ) { recurrence = r }
                    }
                }

                Spacer(Modifier.height(20.dp))

                // Confirm / Update button
                Surface(
                    onClick = {
                        if (!isFormValid) return@Surface
                        val tx = Transaction(
                            id = initialTransaction?.id ?: UUID.randomUUID().toString(),
                            userId = userId,
                            vendor = FormatVendorName.formatVendorName(vendor.ifBlank { "Untitled Vendor" }),
                            amount = if (isRefund) -kotlin.math.abs(amount) else kotlin.math.abs(amount),
                            date = date + "T12:00:00.000Z",
                            budgetId = selectedBudgetId,
                            recurrence = recurrence,
                            label = if (initialTransaction?.label == TransactionLabel.AUTOMATIC)
                                TransactionLabel.AUTOMATIC else TransactionLabel.MANUAL,
                            isProjected = false,
                            isIncome = isRefund,
                            caughtCleared = false,
                            userName = userName,
                            createdAt = initialTransaction?.createdAt
                                ?: java.time.Instant.now().toString(),
                            source = initialTransaction?.source,
                        )
                        onSave(tx)
                        onClose()
                    },
                    color = if (isFormValid) MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.surfaceVariant,
                    shape = RoundedCornerShape(20.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        text = if (initialTransaction != null) "Update Transaction" else "Confirm Entry",
                        style = TextStyle(
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = if (isFormValid) MaterialTheme.colorScheme.onPrimary
                                    else MaterialTheme.colorScheme.onSurfaceVariant,
                        ),
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 12.dp),
                        textAlign = TextAlign.Center,
                    )
                }

                if (initialTransaction != null && onDelete != null) {
                    Spacer(Modifier.height(8.dp))
                    Surface(
                        onClick = onDelete,
                        color = MaterialTheme.colorScheme.surfaceVariant,
                        shape = RoundedCornerShape(20.dp),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 12.dp),
                            horizontalArrangement = Arrangement.Center,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.Delete,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(16.dp),
                            )
                            Spacer(Modifier.width(8.dp))
                            Text(
                                text = "Delete Transaction",
                                style = TextStyle(
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                ),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ToggleButton(
    text: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    selectedTint: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.onSurface,
    onClick: () -> Unit,
) {
    Box(
        modifier = modifier
            .background(
                color = if (selected) MaterialTheme.colorScheme.surface
                        else androidx.compose.ui.graphics.Color.Transparent,
                shape = RoundedCornerShape(50),
            )
            .clickable(onClick = onClick)
            .padding(vertical = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = text,
            style = TextStyle(
                fontSize = 10.sp,
                fontWeight = FontWeight.SemiBold,
                color = if (selected) selectedTint
                        else MaterialTheme.colorScheme.onSurfaceVariant,
            ),
        )
    }
}

@Composable
private fun BudgetGridRow(
    budgets: List<BudgetCategory>,
    selected: String?,
    onToggle: (String) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        budgets.forEach { budget ->
            val isSelected = selected == budget.id
            Box(
                modifier = Modifier
                    .weight(1f)
                    .aspectRatio(1f)
                    .background(
                        color = if (isSelected) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.6f)
                                else MaterialTheme.colorScheme.surface,
                        shape = RoundedCornerShape(20.dp),
                    )
                    .border(
                        width = if (isSelected) 2.dp else 1.dp,
                        color = if (isSelected) MaterialTheme.colorScheme.primary.copy(alpha = 0.5f)
                                else MaterialTheme.colorScheme.outlineVariant,
                        shape = RoundedCornerShape(20.dp),
                    )
                    .clickable { onToggle(budget.id) },
                contentAlignment = Alignment.Center,
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    BudgetIcon(
                        name = budget.name,
                        tint = if (isSelected) MaterialTheme.colorScheme.primary
                               else MaterialTheme.colorScheme.onSurfaceVariant,
                        size = 20.dp,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = budget.name,
                        style = TextStyle(
                            fontSize = 9.sp,
                            fontWeight = FontWeight.Bold,
                            color = if (isSelected) MaterialTheme.colorScheme.primary
                                    else MaterialTheme.colorScheme.onSurface,
                        ),
                        textAlign = TextAlign.Center,
                    )
                }
            }
        }
    }
}

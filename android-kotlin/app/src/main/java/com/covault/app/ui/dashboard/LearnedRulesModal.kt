package com.covault.app.ui.dashboard

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.KeyboardArrowRight
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.covault.app.data.model.BudgetCategory
import com.covault.app.data.model.Transaction
import com.covault.app.data.model.VendorOverride
import com.covault.app.ui.theme.CovaultBackground

/**
 * A learned rule: all vendor overrides that share the same display name and
 * category, plus the transactions those patterns match. Grouping mirrors the
 * `learnedRules` useMemo in `components/transaction_parsing/LearnedRulesCard.tsx`.
 */
private data class LearnedRule(
    val key: String,
    val properName: String,
    val categoryName: String,
    val patterns: List<VendorOverride>,
    val transactions: List<Transaction>,
)

/** Normalized vendor key. Port of `toVendorKey` in deviceTransactionParser.ts. */
private fun toVendorKey(vendor: String): String =
    vendor.lowercase().filter { it.isLetterOrDigit() }

private fun ruleKey(properName: String, categoryName: String): String =
    "$properName::$categoryName"

private fun groupIntoRules(
    overrides: List<VendorOverride>,
    allTransactions: List<Transaction>,
): List<LearnedRule> {
    val groups = LinkedHashMap<String, MutableList<VendorOverride>>()
    for (vo in overrides) {
        val key = ruleKey(vo.properName, vo.categoryName.ifBlank { "Uncategorized" })
        groups.getOrPut(key) { mutableListOf() }.add(vo)
    }
    return groups.map { (_, patterns) ->
        val first = patterns.first()
        val categoryName = first.categoryName.ifBlank { "Uncategorized" }
        val matched = allTransactions.filter { tx ->
            val txKey = toVendorKey(tx.vendor)
            patterns.any { p ->
                val patternKey = toVendorKey(p.matchKey?.ifBlank { p.properName } ?: p.properName)
                if (patternKey.isEmpty()) false else when (p.matchType) {
                    com.covault.app.data.model.MatchType.EXACT -> txKey == patternKey
                    com.covault.app.data.model.MatchType.PREFIX -> txKey.startsWith(patternKey)
                    com.covault.app.data.model.MatchType.CONTAINS -> txKey.contains(patternKey)
                }
            }
        }.distinctBy { it.id }
        LearnedRule(
            key = ruleKey(first.properName, categoryName),
            properName = first.properName,
            categoryName = categoryName,
            patterns = patterns,
            transactions = matched,
        )
    }.sortedBy { it.properName.lowercase() }
}

// Category accent colors that read on both light and dark surfaces.
private val categoryColors: Map<String, Color> = mapOf(
    "Groceries" to Color(0xFF10B981),
    "Housing" to Color(0xFF3B82F6),
    "Transport" to Color(0xFF06B6D4),
    "Utilities" to Color(0xFF8B5CF6),
    "Leisure" to Color(0xFFEC4899),
    "Services" to Color(0xFFF59E0B),
    "Other" to Color(0xFF64748B),
)

@Composable
private fun accentFor(categoryName: String): Color =
    categoryColors[categoryName] ?: MaterialTheme.colorScheme.primary

/**
 * The Learned Rules screen. Lists the user's vendor→category rules and lets
 * them change a rule's category, rename it, merge it into another rule, or
 * delete it. Native Compose throughout — no HTML `<select>` / WebView picker.
 */
@Composable
fun LearnedRulesModal(
    budgets: List<BudgetCategory>,
    transactions: List<Transaction>,
    onClose: () -> Unit,
    viewModel: LearnedRulesViewModel = hiltViewModel(),
) {
    val overrides by viewModel.overrides.collectAsStateWithLifecycle()
    val isLoading by viewModel.isLoading.collectAsStateWithLifecycle()

    val rules = remember(overrides, transactions) { groupIntoRules(overrides, transactions) }

    var expandedKey by remember { mutableStateOf<String?>(null) }
    var mergingKey by remember { mutableStateOf<String?>(null) }
    var editingKey by remember { mutableStateOf<String?>(null) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.scrim.copy(alpha = 0.5f)),
    ) {
        CovaultBackground(modifier = Modifier.fillMaxSize()) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .windowInsetsPadding(WindowInsets.systemBars),
            ) {
                // ── Top bar ──
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(start = 20.dp, end = 12.dp, top = 16.dp, bottom = 8.dp),
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Learned Rules",
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        Text(
                            text = "Vendor mappings and auto-categorization",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
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

                when {
                    isLoading && rules.isEmpty() -> Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center,
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(24.dp),
                            strokeWidth = 2.dp,
                            color = MaterialTheme.colorScheme.primary,
                        )
                    }

                    rules.isEmpty() -> Box(
                        modifier = Modifier.fillMaxSize().padding(32.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = "No learned rules yet. Categorize transactions to build rules.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }

                    else -> LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(
                            start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp,
                        ),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        items(rules, key = { it.key }) { rule ->
                            RuleCard(
                                rule = rule,
                                allRules = rules,
                                budgets = budgets,
                                isExpanded = expandedKey == rule.key,
                                isMerging = mergingKey == rule.key,
                                isEditingName = editingKey == rule.key,
                                onToggleExpand = {
                                    expandedKey = if (expandedKey == rule.key) null else rule.key
                                    mergingKey = null
                                    editingKey = null
                                },
                                onChangeCategory = { budgetName ->
                                    viewModel.setCategory(rule.patterns.map { it.id }, budgetName)
                                },
                                onStartEditName = { editingKey = rule.key; mergingKey = null },
                                onCancelEditName = { editingKey = null },
                                onSaveName = { newName ->
                                    viewModel.setProperName(rule.patterns.map { it.id }, newName)
                                    editingKey = null
                                },
                                onStartMerge = { mergingKey = rule.key; editingKey = null },
                                onCancelMerge = { mergingKey = null },
                                onConfirmMerge = { target ->
                                    viewModel.merge(
                                        sourceIds = rule.patterns.map { it.id },
                                        targetProperName = target.properName,
                                        targetCategoryName = target.categoryName,
                                    )
                                    mergingKey = null
                                    expandedKey = null
                                },
                                onDeletePattern = { id -> viewModel.delete(listOf(id)) },
                                onDeleteRule = {
                                    viewModel.delete(rule.patterns.map { it.id })
                                    expandedKey = null
                                },
                            )
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RuleCard(
    rule: LearnedRule,
    allRules: List<LearnedRule>,
    budgets: List<BudgetCategory>,
    isExpanded: Boolean,
    isMerging: Boolean,
    isEditingName: Boolean,
    onToggleExpand: () -> Unit,
    onChangeCategory: (String) -> Unit,
    onStartEditName: () -> Unit,
    onCancelEditName: () -> Unit,
    onSaveName: (String) -> Unit,
    onStartMerge: () -> Unit,
    onCancelMerge: () -> Unit,
    onConfirmMerge: (LearnedRule) -> Unit,
    onDeletePattern: (String) -> Unit,
    onDeleteRule: () -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f),
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.fillMaxWidth()) {
            // ── Header ──
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onToggleExpand)
                    .padding(vertical = 6.dp),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.weight(1f),
                ) {
                    Spacer(Modifier.width(12.dp))
                    Text(
                        text = rule.properName,
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.widthIn(max = 140.dp),
                    )
                    Text(
                        text = "  →  ",
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        text = rule.categoryName,
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.Bold,
                        color = accentFor(rule.categoryName),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Text(
                    text = "${rule.transactions.size} tx",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                IconButton(onClick = onToggleExpand) {
                    Icon(
                        imageVector = if (isExpanded) Icons.Outlined.KeyboardArrowDown else Icons.Outlined.KeyboardArrowRight,
                        contentDescription = if (isExpanded) "Collapse" else "Expand",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            if (isExpanded) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp)
                        .padding(bottom = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    // ── Match patterns ──
                    SectionLabel("Match Patterns (${rule.patterns.size})")
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        rule.patterns.forEach { pattern ->
                            Surface(
                                color = MaterialTheme.colorScheme.surface,
                                shape = RoundedCornerShape(10.dp),
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(
                                        text = "${pattern.matchType.dbValue}: ${pattern.matchKey?.ifBlank { pattern.properName } ?: pattern.properName}",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurface,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier
                                            .widthIn(max = 180.dp)
                                            .padding(start = 8.dp, top = 4.dp, bottom = 4.dp),
                                    )
                                    IconButton(
                                        onClick = { onDeletePattern(pattern.id) },
                                        modifier = Modifier.size(28.dp),
                                    ) {
                                        Icon(
                                            imageVector = Icons.Outlined.Close,
                                            contentDescription = "Remove pattern",
                                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                            modifier = Modifier.size(14.dp),
                                        )
                                    }
                                }
                            }
                        }
                    }

                    // ── Transactions under this rule ──
                    if (rule.transactions.isNotEmpty()) {
                        SectionLabel("Transactions (${rule.transactions.size})")
                        rule.transactions.take(6).forEach { tx ->
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text(
                                    text = tx.vendor,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurface,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.weight(1f),
                                )
                                Text(
                                    text = "$" + "%.2f".format(kotlin.math.abs(tx.amount)),
                                    style = MaterialTheme.typography.bodySmall,
                                    fontWeight = FontWeight.SemiBold,
                                    color = MaterialTheme.colorScheme.onSurface,
                                )
                            }
                        }
                        if (rule.transactions.size > 6) {
                            Text(
                                text = "+${rule.transactions.size - 6} more",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }

                    // ── Actions ──
                    if (isMerging) {
                        MergeEditor(
                            currentKey = rule.key,
                            allRules = allRules,
                            onCancel = onCancelMerge,
                            onConfirm = onConfirmMerge,
                        )
                    } else if (isEditingName) {
                        EditNameEditor(
                            initial = rule.properName,
                            onCancel = onCancelEditName,
                            onSave = onSaveName,
                        )
                    } else {
                        ActionButtons(
                            budgets = budgets,
                            onChangeCategory = onChangeCategory,
                            onStartEditName = onStartEditName,
                            onStartMerge = onStartMerge,
                            onDeleteRule = onDeleteRule,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text = text.uppercase(),
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ActionButtons(
    budgets: List<BudgetCategory>,
    onChangeCategory: (String) -> Unit,
    onStartEditName: () -> Unit,
    onStartMerge: () -> Unit,
    onDeleteRule: () -> Unit,
) {
    var categoryMenuOpen by remember { mutableStateOf(false) }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box {
            OutlinedButton(onClick = { categoryMenuOpen = true }) {
                Text("Change Category", style = MaterialTheme.typography.labelSmall)
            }
            DropdownMenu(
                expanded = categoryMenuOpen,
                onDismissRequest = { categoryMenuOpen = false },
            ) {
                budgets.forEach { b ->
                    DropdownMenuItem(
                        text = { Text(b.name) },
                        onClick = {
                            onChangeCategory(b.name)
                            categoryMenuOpen = false
                        },
                    )
                }
            }
        }
        OutlinedButton(onClick = onStartEditName) {
            Icon(
                imageVector = Icons.Outlined.Edit,
                contentDescription = null,
                modifier = Modifier.size(14.dp),
            )
            Spacer(Modifier.width(4.dp))
            Text("Edit Name", style = MaterialTheme.typography.labelSmall)
        }
        OutlinedButton(onClick = onStartMerge) {
            Text("Merge", style = MaterialTheme.typography.labelSmall)
        }
        TextButton(onClick = onDeleteRule) {
            Icon(
                imageVector = Icons.Outlined.Delete,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.error,
                modifier = Modifier.size(14.dp),
            )
            Spacer(Modifier.width(4.dp))
            Text(
                "Delete Rule",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.error,
            )
        }
    }
}

/**
 * The merge control, rebuilt natively. The target picker is a full-width
 * Compose [DropdownMenu] (not an HTML `<select>` / native picker), the
 * selected text uses theme colors so it stays legible in dark mode, and the
 * Cancel / Merge buttons sit on their own row so the confirm action can never
 * be pushed off the right edge of the screen.
 */
@Composable
private fun MergeEditor(
    currentKey: String,
    allRules: List<LearnedRule>,
    onCancel: () -> Unit,
    onConfirm: (LearnedRule) -> Unit,
) {
    val targets = remember(allRules, currentKey) { allRules.filter { it.key != currentKey } }
    var menuOpen by remember { mutableStateOf(false) }
    var selected by remember(currentKey) { mutableStateOf<LearnedRule?>(null) }

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        SectionLabel("Merge this rule into")
        Box(modifier = Modifier.fillMaxWidth()) {
            OutlinedButton(
                onClick = { menuOpen = true },
                enabled = targets.isNotEmpty(),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    text = selected?.let { "${it.properName} → ${it.categoryName}" }
                        ?: if (targets.isEmpty()) "No other rules to merge into" else "Select a rule…",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Icon(
                    imageVector = Icons.Outlined.KeyboardArrowDown,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            DropdownMenu(
                expanded = menuOpen,
                onDismissRequest = { menuOpen = false },
            ) {
                targets.forEach { target ->
                    DropdownMenuItem(
                        text = { Text("${target.properName} → ${target.categoryName}") },
                        onClick = {
                            selected = target
                            menuOpen = false
                        },
                    )
                }
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
        ) {
            TextButton(onClick = onCancel) { Text("Cancel") }
            Button(
                onClick = { selected?.let(onConfirm) },
                enabled = selected != null,
            ) { Text("Merge") }
        }
    }
}

@Composable
private fun EditNameEditor(
    initial: String,
    onCancel: () -> Unit,
    onSave: (String) -> Unit,
) {
    var draft by remember(initial) { mutableStateOf(initial) }
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        OutlinedTextField(
            value = draft,
            onValueChange = { draft = it },
            label = { Text("Display name") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
        ) {
            TextButton(onClick = onCancel) { Text("Cancel") }
            Button(
                onClick = { onSave(draft) },
                enabled = draft.isNotBlank(),
            ) { Text("Save") }
        }
    }
}

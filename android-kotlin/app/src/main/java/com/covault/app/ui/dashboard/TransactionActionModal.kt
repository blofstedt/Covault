package com.covault.app.ui.dashboard

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.covault.app.data.model.BudgetCategory
import com.covault.app.data.model.Transaction

/**
 * Action modal shown when the user taps a transaction. The React app
 * just reuses `TransactionForm` with the initial-transaction prop set
 * and adds a Delete button at the bottom. We do the same: this
 * composable is a thin wrapper that hosts the form + a local
 * delete-confirm state.
 */
@Composable
fun TransactionActionModal(
    transaction: Transaction,
    budgets: List<BudgetCategory>,
    currentUserName: String,
    isSharedAccount: Boolean,
    vendorHistory: List<VendorHistoryItem> = emptyList(),
    onClose: () -> Unit,
    onEdit: (Transaction) -> Unit,
    onDelete: () -> Unit,
) {
    var showDeleteConfirm by remember { mutableStateOf(false) }

    if (showDeleteConfirm) {
        ConfirmDeleteModal(
            onClose = { showDeleteConfirm = false },
            onConfirm = {
                onDelete()
                onClose()
            },
        )
        return
    }

    TransactionForm(
        onClose = onClose,
        onSave = { updatedTx ->
            onEdit(updatedTx)
            onClose()
        },
        budgets = budgets,
        userId = transaction.userId,
        userName = currentUserName,
        initialTransaction = transaction,
        isSharedAccount = isSharedAccount,
        vendorHistory = vendorHistory,
        onDelete = { showDeleteConfirm = true },
    )
}

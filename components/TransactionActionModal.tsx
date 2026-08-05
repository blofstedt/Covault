import React, { useState } from 'react';
import { Transaction, BudgetCategory } from '../types';
import TransactionForm from './TransactionForm';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import { useEscapeKey } from '../lib/hooks/useEscapeKey';
import { normalizeRecurrence } from '../lib/recurrence';

interface VendorHistoryItem {
  vendor: string;
  budget_id: string;
}

interface TransactionActionModalProps {
  transaction: Transaction;
  budgets: BudgetCategory[];
  currentUserName: string;
  isSharedAccount: boolean;
  vendorHistory?: VendorHistoryItem[];
  onClose: () => void;
  onEdit: (tx: Transaction) => void;
  onDelete: () => void;
  onVendorOverrideUpdated?: (vendor: string, categoryName: string) => void;
}

const TransactionActionModal: React.FC<TransactionActionModalProps> = ({
  transaction,
  budgets,
  currentUserName,
  isSharedAccount,
  vendorHistory = [],
  onClose,
  onEdit,
  onDelete,
  onVendorOverrideUpdated,
}) => {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Stand down while the delete confirmation is up, so Escape dismisses that first.
  useEscapeKey(onClose, !showDeleteConfirm);

  // A recurring entry doesn't delete alone: this occurrence and every one after
  // it go, while the ones that already happened stay. The warning belongs here,
  // BEFORE anything is deleted — it used to be carried partly by the toast that
  // appears afterwards, which on a phone renders under the status bar and is
  // effectively invisible. A warning nobody can read is not a warning, and it
  // arrived after the irreversible part anyway.
  const isRecurring = normalizeRecurrence(transaction) !== 'one-time';

  if (showDeleteConfirm) {
    return (
      <ConfirmDeleteModal
        isRecurring={isRecurring}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => {
          onDelete();
          onClose();
        }}
      />
    );
  }

  // Directly show the edit form with a delete button at the bottom
  return (
    <TransactionForm
      onClose={onClose}
      onSave={(updatedTx) => onEdit(updatedTx)}
      budgets={budgets}
      userId={transaction.user_id}
      userName={currentUserName}
      initialTransaction={transaction}
      isSharedAccount={isSharedAccount}
      vendorHistory={vendorHistory}
      onDelete={() => setShowDeleteConfirm(true)}
      onVendorOverrideUpdated={onVendorOverrideUpdated}
    />
  );
};

export default TransactionActionModal;
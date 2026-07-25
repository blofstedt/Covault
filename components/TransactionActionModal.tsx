import React, { useState } from 'react';
import { Transaction, BudgetCategory } from '../types';
import TransactionForm from './TransactionForm';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import { useEscapeKey } from '../lib/hooks/useEscapeKey';

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

  if (showDeleteConfirm) {
    return (
      <ConfirmDeleteModal
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

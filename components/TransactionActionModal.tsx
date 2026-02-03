import React, { useState, useEffect } from 'react';
import { Transaction, BudgetCategory } from '../types';
import TransactionForm from './TransactionForm';
import ConfirmDeleteModal from './ConfirmDeleteModal';

interface TransactionActionModalProps {
  transaction: Transaction;
  budgets: BudgetCategory[];
  currentUserName: string;
  isSharedAccount: boolean;
  onClose: () => void;
  onEdit: (tx: Transaction) => void;
  onDelete: () => void;
}

const TransactionActionModal: React.FC<TransactionActionModalProps> = ({
  transaction,
  budgets,
  currentUserName,
  isSharedAccount,
  onClose,
  onEdit,
  onDelete,
}) => {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Handle Escape key to close modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !showDeleteConfirm) {
        onClose();
      }
    };
    
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose, showDeleteConfirm]);

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
      onSave={(updatedTx) => {
        onEdit(updatedTx);
        onClose();
      }}
      budgets={budgets}
      userId={transaction.user_id}
      userName={currentUserName}
      initialTransaction={transaction}
      isSharedAccount={isSharedAccount}
      onDelete={() => setShowDeleteConfirm(true)}
    />
  );
};

export default TransactionActionModal;

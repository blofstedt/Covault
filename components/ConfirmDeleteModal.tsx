
import React from 'react';
import ConfirmModal from './ui/ConfirmModal';

interface ConfirmDeleteModalProps {
  onClose: () => void;
  onConfirm: () => void;
  /** Override for recurring entries, where the delete reaches further. */
  message?: string;
}

const ConfirmDeleteModal: React.FC<ConfirmDeleteModalProps> = ({ onClose, onConfirm, message }) => {
  return (
    <ConfirmModal
      title="Remove Entry?"
      message={message ?? 'This action will permanently delete this transaction from your vault.'}
      confirmLabel="Confirm Delete"
      variant="danger"
      onConfirm={onConfirm}
      onCancel={onClose}
    />
  );
};

export default ConfirmDeleteModal;

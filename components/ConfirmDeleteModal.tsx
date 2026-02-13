
import React from 'react';
import ConfirmModal from './ui/ConfirmModal';

interface ConfirmDeleteModalProps {
  onClose: () => void;
  onConfirm: () => void;
}

const ConfirmDeleteModal: React.FC<ConfirmDeleteModalProps> = ({ onClose, onConfirm }) => {
  return (
    <ConfirmModal
      title="Remove Entry?"
      message="This action will permanently delete this transaction from your vault."
      confirmLabel="Confirm Delete"
      variant="danger"
      onConfirm={onConfirm}
      onCancel={onClose}
    />
  );
};

export default ConfirmDeleteModal;

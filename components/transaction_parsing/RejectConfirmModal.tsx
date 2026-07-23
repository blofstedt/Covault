import React from 'react';
import ConfirmModal from '../ui/ConfirmModal';

interface RejectConfirmModalProps {
  rejectConfirmId: string;
  onCancel: () => void;
  onConfirm: (id: string) => void;
}

const RejectConfirmModal: React.FC<RejectConfirmModalProps> = ({
  rejectConfirmId,
  onCancel,
  onConfirm,
}) => (
  <ConfirmModal
    title="Reject Transaction?"
    message="This transaction will be permanently dismissed and won't appear in your review list."
    confirmLabel="Reject"
    cancelLabel="Cancel"
    variant="danger"
    icon={
      <svg className="w-6 h-6 text-red-500 dark:text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    }
    onConfirm={() => onConfirm(rejectConfirmId)}
    onCancel={onCancel}
  />
);

export default RejectConfirmModal;

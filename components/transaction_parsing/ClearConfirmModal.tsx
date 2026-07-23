import React from 'react';
import ConfirmModal from '../ui/ConfirmModal';

interface ClearConfirmModalProps {
  cardName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ClearConfirmModal: React.FC<ClearConfirmModalProps> = ({
  cardName,
  onConfirm,
  onCancel,
}) => (
  <ConfirmModal
    title={`Clear ${cardName}?`}
    message={`All notifications in "${cardName}" will be permanently removed.`}
    confirmLabel="Clear"
    cancelLabel="Cancel"
    variant="danger"
    icon={
      <svg className="w-6 h-6 text-rose-500 dark:text-rose-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
      </svg>
    }
    onConfirm={onConfirm}
    onCancel={onCancel}
  />
);

export default ClearConfirmModal;

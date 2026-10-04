import React from 'react';
import ConfirmModal from '../ui/ConfirmModal';

interface DeleteAllConfirmModalProps {
  /** How many rows will be deleted. Drives the copy so the blast radius is stated. */
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation for the trash action on the review list.
 *
 * The neighbouring "Clear all" is deliberately safe — it only files rows, and
 * ClearConfirmModal says so. This one is the opposite and the copy has to be
 * just as plain about it: the transactions leave Covault entirely, so the money
 * comes back out of the budgets they were counted against, and there is no undo.
 */
const DeleteAllConfirmModal: React.FC<DeleteAllConfirmModalProps> = ({
  count,
  onConfirm,
  onCancel,
}) => (
  <ConfirmModal
    title={count === 1 ? 'Delete this transaction?' : `Delete all ${count} transactions?`}
    message={
      count === 1
        ? 'It leaves Covault for good — the review list, your history and its budget. This cannot be undone.'
        : 'They leave Covault for good — the review list, your history and their budgets. This cannot be undone.'
    }
    confirmLabel={count === 1 ? 'Delete it' : `Delete all ${count}`}
    cancelLabel="Cancel"
    variant="danger"
    onConfirm={onConfirm}
    onCancel={onCancel}
  />
);

export default DeleteAllConfirmModal;

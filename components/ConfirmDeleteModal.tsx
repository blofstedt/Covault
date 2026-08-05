import React from 'react';
import ConfirmModal from './ui/ConfirmModal';

interface ConfirmDeleteModalProps {
  onClose: () => void;
  onConfirm: () => void;
  /**
   * True when the entry repeats. A recurring delete reaches past the row the
   * user tapped — it takes every later occurrence with it and ends the series —
   * so it gets its own title and wording rather than the generic one.
   */
  isRecurring?: boolean;
  /** Escape hatch for callers with something more specific to say. */
  message?: string;
}

/**
 * Stated in the order the consequences matter: what this is, then what goes,
 * then what survives. That last sentence is the part users get wrong when it is
 * left implied — "all future recurrences" reads to some people as the whole
 * series, including the occurrences they have already paid.
 *
 * Exported so the wording is covered by a test rather than left to drift.
 */
export const RECURRING_DELETE_MESSAGE =
  'This is a recurring transaction. Deleting will remove this and all future recurrences. Entries before this one stay in your vault.';

export const ONE_TIME_DELETE_MESSAGE =
  'This action will permanently delete this transaction from your vault.';

const ConfirmDeleteModal: React.FC<ConfirmDeleteModalProps> = ({
  onClose,
  onConfirm,
  isRecurring = false,
  message,
}) => {
  return (
    <ConfirmModal
      title={isRecurring ? 'Remove Recurring Entry?' : 'Remove Entry?'}
      message={
        message ??
        (isRecurring ? RECURRING_DELETE_MESSAGE : ONE_TIME_DELETE_MESSAGE)
      }
      confirmLabel={isRecurring ? 'Delete All Future' : 'Confirm Delete'}
      variant="danger"
      onConfirm={onConfirm}
      onCancel={onClose}
    />
  );
};

export default ConfirmDeleteModal;

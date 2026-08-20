import React from 'react';
import ConfirmModal from '../ui/ConfirmModal';

interface ClearAutoFiledConfirmModalProps {
  /** How many rows leave the list. Drives the copy so the blast radius is stated. */
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation for "Clear" on the "Filed automatically" card.
 *
 * The card is a receipt: everything on it is already filed, already in a
 * budget, and already counted. Clearing it only says "I've seen these" — so the
 * copy has to lead with what does NOT happen, the same way ClearConfirmModal
 * does for the review list. The neighbouring red trash action on the review
 * card is the destructive one, and nothing here should be mistaken for it.
 */
const ClearAutoFiledConfirmModal: React.FC<ClearAutoFiledConfirmModalProps> = ({
  count,
  onConfirm,
  onCancel,
}) => (
  <ConfirmModal
    title={count === 1 ? 'Clear this from the list?' : `Clear all ${count} from the list?`}
    message={
      count === 1
        ? 'It stays in your history and budget — this just clears it from what Covault filed for you.'
        : 'They stay in your history and budgets — this just clears them from what Covault filed for you.'
    }
    confirmLabel={count === 1 ? 'Clear it' : 'Clear them'}
    cancelLabel="Cancel"
    variant="neutral"
    icon={
      <svg className="w-8 h-8 text-emerald-500 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6L9 17l-5-5" />
        <path d="M20 12v6a2 2 0 01-2 2H6a2 2 0 01-2-2v-6" />
      </svg>
    }
    onConfirm={onConfirm}
    onCancel={onCancel}
  />
);

export default ClearAutoFiledConfirmModal;

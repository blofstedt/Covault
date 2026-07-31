import React from 'react';
import ConfirmModal from '../ui/ConfirmModal';

interface ClearConfirmModalProps {
  /** How many rows will be filed. Drives the copy so the user knows the blast radius. */
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation for the "Clear all" action on the review list.
 *
 * This used to be a red trash-can danger dialog reading "All notifications in
 * 'Caught Transactions' will be permanently removed." That was wrong on both
 * counts. The action behind it (handleClearEntered in TransactionParsing) only
 * PATCHes caught_cleared: true — the transactions stay in the user's history and
 * keep counting toward their budgets. Nothing is deleted, and the card has not
 * been called "Caught Transactions" for a while either.
 *
 * Describing a safe action as irreversible destruction is worse than a cosmetic
 * bug: it steers people away from the one control that does exactly what they
 * want when a screen of correctly-categorised rows is staring at them.
 */
const ClearConfirmModal: React.FC<ClearConfirmModalProps> = ({
  count,
  onConfirm,
  onCancel,
}) => (
  <ConfirmModal
    title={count === 1 ? 'File this transaction?' : `File all ${count} transactions?`}
    message={
      count === 1
        ? 'It stays in your history and budget — this just clears it from the review list.'
        : 'They stay in your history and budgets — this just clears them from the review list.'
    }
    confirmLabel={count === 1 ? 'File it' : 'File them'}
    cancelLabel="Cancel"
    variant="neutral"
    icon={
      <svg className="w-8 h-8 text-emerald-500 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 12h-6l-2 3h-4l-2-3H2" />
        <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
      </svg>
    }
    onConfirm={onConfirm}
    onCancel={onCancel}
  />
);

export default ClearConfirmModal;

import React from 'react';
import ConfirmModal from './ui/ConfirmModal';
import {
  DELETE_ACCOUNT_TITLE,
  DELETE_ACCOUNT_MESSAGE,
  DELETE_ACCOUNT_CONFIRM_LABEL,
} from '../lib/accountDeletion';

interface DeleteAccountModalProps {
  onClose: () => void;
  onConfirm: () => void;
  /** True while the deletion is in flight, so a second tap can't fire twice. */
  busy?: boolean;
}

/**
 * Built on the same ConfirmModal every other destructive confirmation in this
 * app uses — see ConfirmDeleteModal and DeleteAllConfirmModal — because a
 * different dialog shape for the one irreversible action would draw the eye
 * to it less, not more. The weight comes from the words
 * (lib/accountDeletion.ts), not from a heavier component.
 */
const DeleteAccountModal: React.FC<DeleteAccountModalProps> = ({ onClose, onConfirm, busy = false }) => (
  <ConfirmModal
    title={DELETE_ACCOUNT_TITLE}
    message={DELETE_ACCOUNT_MESSAGE}
    confirmLabel={busy ? 'Deleting…' : DELETE_ACCOUNT_CONFIRM_LABEL}
    cancelLabel="Keep My Account"
    variant="danger"
    onConfirm={() => {
      if (!busy) onConfirm();
    }}
    onCancel={onClose}
  />
);

export default DeleteAccountModal;

import React, { useState } from 'react';
import DeleteAccountModal from '../../DeleteAccountModal';
import { DELETE_ACCOUNT_ENTRY_LABEL } from '../../../lib/accountDeletion';

interface DeleteAccountSectionProps {
  /**
   * Resolves once the attempt is over, success or failure. On success the
   * caller signs the session out, which unmounts this modal along with the
   * rest of the signed-in app — so `busy` only ever has to cover a failure,
   * where control comes back here and the modal has to still be usable.
   */
  onDeleteAccount: () => Promise<void>;
}

/**
 * The one settings row with no undo, kept visually apart from the rest.
 *
 * Sign out sits directly above this and needs no confirmation at all — it is
 * completely reversible. This does, which is the whole reason it is a
 * separate row rather than a second button beside Sign Out: two destructive
 * actions of very different weight should not read as equally easy.
 */
const DeleteAccountSection: React.FC<DeleteAccountSectionProps> = ({ onDeleteAccount }) => {
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onDeleteAccount();
      // A successful deletion signs the session out from underneath this
      // component; nothing here runs again. Only a failure returns control,
      // which is the one case `busy` has to unwind.
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        id="delete-account-button"
        onClick={() => setShowConfirm(true)}
        className="w-full py-3.5 text-xs text-rose-400 dark:text-rose-500/80 font-semibold bg-transparent border border-rose-200 dark:border-rose-900/40 rounded-2xl active:scale-[0.97] transition-all duration-200 tracking-wide mt-3"
      >
        {DELETE_ACCOUNT_ENTRY_LABEL}
      </button>

      {showConfirm && (
        <DeleteAccountModal
          busy={busy}
          onClose={() => setShowConfirm(false)}
          onConfirm={handleConfirm}
        />
      )}
    </>
  );
};

export default DeleteAccountSection;

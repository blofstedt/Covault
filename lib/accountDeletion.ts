// lib/accountDeletion.ts
//
// The words for the one action in this app with no undo.
//
// Every other destructive confirmation here — a single transaction, the whole
// review queue — survives a wrong tap: the row is still in the database, or a
// toast offers Undo. This one calls delete_own_account(), which does not
// leave anything to restore. The wording has to carry that weight on its own,
// which is why it is pulled out and tested rather than typed once into a
// modal and trusted.

export const DELETE_ACCOUNT_TITLE = 'Delete your account?';

export const DELETE_ACCOUNT_MESSAGE =
  "This permanently deletes your account, every transaction, and every budget you've set — on this device and everywhere else your vault is signed in. If you share a vault, your partner keeps their own account, but the link between you is removed. There is no undo and nothing to restore afterward.";

export const DELETE_ACCOUNT_CONFIRM_LABEL = 'Delete My Account';

/** Shown on the button that opens the confirmation, not inside it. */
export const DELETE_ACCOUNT_ENTRY_LABEL = 'Delete Account';

/**
 * What the user is told when the deletion itself fails.
 *
 * Distinct from a generic "something went wrong": failing to delete an
 * account the user has just been told, in the modal, will be gone for good is
 * the one place an ambiguous error is worst — someone who sees a vague
 * failure has no way to know whether it half-happened. This says plainly that
 * nothing changed and that trying again is safe, because delete_own_account()
 * either completes entirely or raises before touching anything (a single
 * function body is one transaction).
 */
export function deleteAccountErrorMessage(rpcMessage: string | undefined): string {
  const detail = (rpcMessage || '').trim();
  const suffix = detail && detail.toLowerCase() !== 'not authenticated' ? ` (${detail})` : '';
  return `Could not delete your account — nothing was changed. Try again${suffix}.`;
}

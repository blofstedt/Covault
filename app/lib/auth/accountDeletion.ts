// App/Lib/Auth/accountDeletion.ts
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

/** What the user is told after the deletion request returns without success. */
export function deleteAccountErrorMessage(
  rpcMessage: string | undefined,
  failureKind: 'rejected' | 'unknown' = 'unknown',
): string {
  const detail = (rpcMessage || '').trim().toLowerCase();

  if (failureKind === 'rejected') {
    if (detail === 'not authenticated') {
      return 'Your session could not be verified. Sign in again and check your account before trying again.';
    }
    return 'Your account was not deleted. You can try deleting it again.';
  }

  return 'We could not confirm whether your account was deleted. Sign out and check whether you can sign in before trying again.';
}

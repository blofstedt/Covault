import type { Toast, Transaction } from '../types';

/**
 * The toast's text, with the vendor name it mentions brought up to date.
 *
 * A toast is composed once, when the thing it reports happened, and then sits
 * on screen for several seconds. If the user renames the row in that window —
 * from the transaction sheet, or from the rules list — the strip goes on
 * naming the vendor the old way, which is indistinguishable from the rename
 * having failed.
 *
 * Nothing happens unless the caller attached a `subject`, and nothing happens
 * unless the row is still there and its vendor has actually changed. The
 * substitution is by name rather than by rebuilding the sentence so that one
 * function covers every message shape ("Filed X", "Learned X → Groceries")
 * without each caller having to hand over a template.
 */
export function resolveToastMessage(
  toast: Toast,
  transactions: Transaction[],
): string {
  const subject = toast.subject;
  if (!subject || !subject.vendor) return toast.message;

  const row = transactions.find((t) => t.id === subject.transactionId);
  const current = (row?.vendor || '').trim();
  // No row means it has been deleted since — the message is a record of
  // something that happened, and the name it used is the best one left.
  if (!current || current === subject.vendor) return toast.message;

  return toast.message.split(subject.vendor).join(current);
}

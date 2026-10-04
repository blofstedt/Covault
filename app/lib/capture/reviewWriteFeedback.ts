export type ReviewWriteAction = 'file' | 'delete';
export type ReviewWriteFailureKind = 'rejected' | 'unknown';

/** Copy for a Review write that did not return a confirmed success. */
export function reviewWriteFailureMessage(
  action: ReviewWriteAction,
  failureKind: ReviewWriteFailureKind,
  count: number,
): string {
  const plural = count !== 1;

  if (failureKind === 'unknown') {
    return action === 'file'
      ? plural
        ? "Couldn't confirm whether these purchases were filed. Check Review before trying again."
        : "Couldn't confirm whether this purchase was filed. Check Review before trying again."
      : plural
        ? "Couldn't confirm whether these purchases were deleted. Check Review before trying again."
        : "Couldn't confirm whether this purchase was deleted. Check Review before trying again.";
  }

  return action === 'file'
    ? plural
      ? 'Could not file these purchases. They are still in Review.'
      : 'Could not file this purchase. It is still in Review.'
    : plural
      ? 'Could not delete these purchases. They are still in Review.'
      : 'Could not delete this purchase. It is still in Review.';
}

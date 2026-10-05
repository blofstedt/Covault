import { describe, expect, it } from 'vitest';
import { reviewWriteFailureMessage } from '../reviewWriteFeedback';

describe('Review write failure messages', () => {
  it('states that rejected single and bulk filings remain in Review', () => {
    expect(reviewWriteFailureMessage('file', 'rejected', 1)).toBe(
      'Could not file this purchase. It is still in Review.',
    );
    expect(reviewWriteFailureMessage('file', 'rejected', 2)).toBe(
      'Could not file these purchases. They are still in Review.',
    );
  });

  it('asks the person to check Review when the filing result is unknown', () => {
    expect(reviewWriteFailureMessage('file', 'unknown', 1)).toBe(
      "Couldn't confirm whether this purchase was filed. Check Review before trying again.",
    );
    expect(reviewWriteFailureMessage('file', 'unknown', 3)).toBe(
      "Couldn't confirm whether these purchases were filed. Check Review before trying again.",
    );
  });

  it('does not claim an unknown delete failed or encourage an immediate retry', () => {
    const message = reviewWriteFailureMessage('delete', 'unknown', 1);

    expect(message).toBe("Couldn't confirm whether this purchase was deleted. Check Review before trying again.");
    expect(message).not.toMatch(/nothing was removed|try again\./i);
  });
});

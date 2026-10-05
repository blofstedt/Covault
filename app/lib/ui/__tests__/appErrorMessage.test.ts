import { describe, expect, it } from 'vitest';
import { appErrorMessage } from '../appErrorMessage';

describe('appErrorMessage', () => {
  it('keeps useful budget context without showing backend details', () => {
    const message = appErrorMessage('[saveBudgetLimit] PATCH failed (400): private schema detail');

    expect(message).toBe("Covault couldn't confirm whether your budget changed. Check the budget before trying again.");
    expect(message).not.toContain('private schema detail');
  });

  it('does not echo exception text or arbitrary objects', () => {
    const privateText = 'private vendor name and database stack';

    expect(appErrorMessage(new Error(privateText))).toBe(
      "Covault couldn't confirm whether that request completed. Check the screen before trying again.",
    );
    expect(appErrorMessage({ message: privateText })).toBe(
      "Covault couldn't confirm whether that request completed. Check the screen before trying again.",
    );
    expect(appErrorMessage(new Error(privateText))).not.toContain(privateText);
  });

  it('does not mistake a bare fetch failure for a read failure', () => {
    expect(appErrorMessage('Failed to fetch')).toBe(
      "Covault couldn't confirm whether that request completed. Check the screen before trying again.",
    );
  });

  it('recognizes explicitly named reads, including camelCase operations', () => {
    expect(appErrorMessage('fetchTransactions failed (503): private response body')).toBe(
      "Covault couldn't load your purchases. Check your connection, then refresh Review.",
    );
  });

  it('uses load guidance for read failures instead of suggesting a write retry', () => {
    expect(appErrorMessage('Load transactions failed (503): private response body')).toBe(
      "Covault couldn't load your purchases. Check your connection, then refresh Review.",
    );
  });
});

/**
 * The one settings action with no undo, and the one place a vague error is
 * worst: someone told, in the confirmation modal itself, that this cannot be
 * reversed needs to know for certain whether it half-happened. It never does
 * — delete_own_account() is one function body, so it either commits entirely
 * or raises before touching anything — and the message says so.
 */
import { describe, it, expect } from 'vitest';
import {
  DELETE_ACCOUNT_TITLE,
  DELETE_ACCOUNT_MESSAGE,
  DELETE_ACCOUNT_CONFIRM_LABEL,
  DELETE_ACCOUNT_ENTRY_LABEL,
  deleteAccountErrorMessage,
} from '../accountDeletion';

describe('deleteAccountErrorMessage', () => {
  it('allows retry only after an explicit rejection and does not expose server detail', () => {
    const message = deleteAccountErrorMessage('permission denied: private details', 'rejected');

    expect(message).toBe('Your account was not deleted. You can try deleting it again.');
    expect(message).not.toContain('private details');
  });

  it('directs an unknown result to a sign-in check before another deletion attempt', () => {
    const message = deleteAccountErrorMessage('socket closed with private details', 'unknown');

    expect(message).toBe('We could not confirm whether your account was deleted. Sign out and check whether you can sign in before trying again.');
    expect(message).not.toContain('socket closed');
    expect(message).not.toMatch(/nothing was changed/i);
  });

  it('gives a safe sign-in next step for a confirmed expired session', () => {
    expect(deleteAccountErrorMessage('Not authenticated', 'rejected')).toBe(
      'Your session could not be verified. Sign in again and check your account before trying again.',
    );
  });

  it('treats missing failure classification as unknown', () => {
    expect(deleteAccountErrorMessage('')).toContain('could not confirm whether your account was deleted');
  });
});

describe('the words carry the weight, since the dialog does not', () => {
  it('says what specifically is gone, not just "your account"', () => {
    expect(DELETE_ACCOUNT_MESSAGE).toMatch(/transaction/i);
    expect(DELETE_ACCOUNT_MESSAGE).toMatch(/budget/i);
  });

  it('says what a linked partner keeps, so nobody assumes it deletes both accounts', () => {
    expect(DELETE_ACCOUNT_MESSAGE).toMatch(/partner/i);
  });

  it('says there is no undo, in those terms', () => {
    expect(DELETE_ACCOUNT_MESSAGE.toLowerCase()).toContain('no undo');
  });

  it('every label is non-empty', () => {
    for (const label of [
      DELETE_ACCOUNT_TITLE,
      DELETE_ACCOUNT_CONFIRM_LABEL,
      DELETE_ACCOUNT_ENTRY_LABEL,
    ]) {
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

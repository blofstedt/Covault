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
  it('says plainly that nothing changed', () => {
    expect(deleteAccountErrorMessage(undefined)).toMatch(/nothing was changed/i);
  });

  it('folds in the server detail when there is one worth showing', () => {
    expect(deleteAccountErrorMessage('Network error')).toContain('Network error');
  });

  it('does not repeat "Not authenticated" back at a session that has simply expired', () => {
    // The RPC raises this when the session is already gone by the time the
    // request lands — signing back in and trying again is the fix, and the
    // generic message already implies that; parroting the guard's own words
    // back reads as a bug report, not an explanation.
    const message = deleteAccountErrorMessage('Not authenticated');
    expect(message.toLowerCase()).not.toContain('not authenticated');
  });

  it('is never empty even with nothing to add', () => {
    expect(deleteAccountErrorMessage('').length).toBeGreaterThan(0);
    expect(deleteAccountErrorMessage(undefined).length).toBeGreaterThan(0);
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

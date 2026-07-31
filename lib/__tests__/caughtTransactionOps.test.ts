import { describe, it, expect } from 'vitest';
import { buildFilePayload, buildUndoPayload } from '../caughtTransactionOps';

/**
 * Accepting a caught transaction now offers an Undo, so the undo write has to
 * be the exact inverse of the file write. The trap is the category: Accept can
 * be reached from a path that also moved the row (Change category → file), so
 * an Undo that only flips `caught_cleared` back would return the row to the
 * review list under a budget the user never chose — a silent recategorisation
 * dressed up as a no-op.
 */

describe('buildFilePayload', () => {
  it('clears the row from the review list', () => {
    expect(buildFilePayload()).toEqual({ caught_cleared: true });
  });

  it('carries a category change along with the file', () => {
    expect(buildFilePayload({ budget: 'Groceries' })).toEqual({
      caught_cleared: true,
      budget: 'Groceries',
    });
  });

  it('does not let extras override the flag that defines the operation', () => {
    // `caught_cleared` is spread first on purpose... verify it stays that way.
    // If this ever flips, a caller passing caught_cleared:false would produce a
    // "file" that doesn't file.
    expect(buildFilePayload({ caught_cleared: false })).toEqual({ caught_cleared: false });
  });
});

describe('buildUndoPayload', () => {
  it('returns the row to the review list', () => {
    expect(buildUndoPayload(null)).toEqual({ caught_cleared: false });
  });

  it('restores the category the row had before filing', () => {
    expect(buildUndoPayload('Groceries')).toEqual({
      caught_cleared: false,
      budget: 'Groceries',
    });
  });

  it('omits budget entirely rather than writing null', () => {
    // Writing an explicit null would clobber a category set between the file
    // and the undo. A row that never had one should just come back without one.
    expect(Object.keys(buildUndoPayload(null))).toEqual(['caught_cleared']);
  });

  it('treats an empty string as no previous category', () => {
    expect(buildUndoPayload('')).toEqual({ caught_cleared: false });
  });
});

describe('file/undo round trip', () => {
  it('undo inverts every field file wrote', () => {
    const previousBudget = 'Leisure';
    const file = buildFilePayload({ budget: 'Transport' });
    const undo = buildUndoPayload(previousBudget);

    expect(file.caught_cleared).toBe(true);
    expect(undo.caught_cleared).toBe(false);
    // The category the file moved the row to is not left behind.
    expect(file.budget).toBe('Transport');
    expect(undo.budget).toBe(previousBudget);
    expect(Object.keys(undo).sort()).toEqual(Object.keys(file).sort());
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  RECURRING_DELETE_MESSAGE,
  ONE_TIME_DELETE_MESSAGE,
} from '../../components/ConfirmDeleteModal';

const APP_PATH = resolve(__dirname, '../../App.tsx');
const ACTION_MODAL_PATH = resolve(__dirname, '../../components/TransactionActionModal.tsx');

/**
 * Deleting one occurrence of a recurring charge takes every later occurrence
 * with it and ends the series. The user has to be told that before it happens,
 * in something they can actually read.
 */
describe('the recurring delete warning', () => {
  it('says it is recurring, and that future repeats go too', () => {
    expect(RECURRING_DELETE_MESSAGE).toMatch(/recurring transaction/i);
    expect(RECURRING_DELETE_MESSAGE).toMatch(/all future recurrences/i);
  });

  it('says what survives, which is the part users get wrong', () => {
    expect(RECURRING_DELETE_MESSAGE).toMatch(/stay in your vault/i);
  });

  it('is not the one-time wording', () => {
    expect(RECURRING_DELETE_MESSAGE).not.toBe(ONE_TIME_DELETE_MESSAGE);
  });

  it('is raised before the delete, from the confirmation modal', () => {
    const source = readFileSync(ACTION_MODAL_PATH, 'utf-8');
    // The modal must be told whether the entry recurs, and it must still be
    // rendered ahead of onDelete() rather than after it.
    expect(source).toMatch(/isRecurring=\{isRecurring\}/);
    const modalAt = source.indexOf('<ConfirmDeleteModal');
    const deleteAt = source.indexOf('onDelete();');
    expect(modalAt).toBeGreaterThan(-1);
    expect(modalAt).toBeLessThan(deleteAt);
  });
});

/**
 * The toast that follows a delete used to sit at `top-4`, which on a phone is
 * behind the status bar and the notch. Every toast the app raises goes through
 * this one element — delete/undo and every database error — so the position is
 * worth holding onto.
 */
describe('the toast is somewhere it can be read', () => {
  const app = readFileSync(APP_PATH, 'utf-8');

  it('is not pinned under the system status bar', () => {
    expect(app).not.toMatch(/fixed top-4 left-1\/2/);
  });

  it('sits above the bottom bar and respects the safe-area inset', () => {
    expect(app).toMatch(/fixed bottom-\[calc\(env\(safe-area-inset-bottom/);
  });

  it('no longer carries the warning the modal now gives before the delete', () => {
    expect(app).not.toMatch(/including future ones/);
  });
});

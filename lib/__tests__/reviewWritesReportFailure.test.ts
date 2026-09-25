/**
 * Filing or deleting in Review says so when it did not happen.
 *
 * `fetch` does not throw on a refused request, and the Review page only
 * guarded against a throw — so a filing the database refused was followed by
 * "Filed Safeway" with an Undo, and the row came back into Review a moment
 * later on the reload, which reads as the tap having been ignored. Clearing
 * and deleting the whole list failed with nothing on screen at all, having
 * already taken the capture notifications down.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PARSING = readFileSync(resolve(__dirname, '../../components/TransactionParsing.tsx'), 'utf8');

const body = (name: string, length = 2400) => {
  const at = PARSING.indexOf(`const ${name}`);
  expect(at, `${name} should exist`).toBeGreaterThan(-1);
  return PARSING.slice(at, at + length);
};

describe('a Review write the database refuses', () => {
  it('filing one row checks the answer and reports a failure', () => {
    const file = body('fileCaughtTransaction');
    expect(file).toContain('filed = res.ok');
    expect(file).toContain("onToast?.({ tone: 'error', message: FILE_FAILED_MESSAGE })");
    expect(file).toContain('return false;');
  });

  it('accepting does not announce "Filed" for a row that was not filed', () => {
    expect(body('handleAcceptCaught')).toContain('if (!(await fileCaughtTransaction(tx.id))) return;');
  });

  it('changing a category does not announce "Learned" over a failed filing', () => {
    const change = body('handleChangeCaughtCategory', 4000);
    expect(change).toContain("if (!(await fileCaughtTransaction(tx.id, { budget: 'Other' }))) return;");
    expect(change).toContain('if (!(await fileCaughtTransaction(tx.id, name ? { budget: name } : {}))) return;');
  });

  it('bulk accept, clear and delete-all each report a failure', () => {
    expect(body('handleAcceptMany')).toContain('FILE_FAILED_MESSAGE');
    expect(body('handleClearEntered')).toContain('FILE_FAILED_MESSAGE');
    expect(body('handleDeleteAllEntered')).toContain('DELETE_FAILED_MESSAGE');
  });

  it('takes capture notifications down only after the rows are really dealt with', () => {
    const deleteAll = body('handleDeleteAllEntered');
    expect(deleteAll.indexOf('dismissCaptureNotification')).toBeGreaterThan(
      deleteAll.indexOf('if (!res.ok)'),
    );
    const clear = body('handleClearEntered');
    expect(clear.indexOf('dismissCaptureNotification')).toBeGreaterThan(
      clear.indexOf('if (!res.ok)'),
    );
  });
});

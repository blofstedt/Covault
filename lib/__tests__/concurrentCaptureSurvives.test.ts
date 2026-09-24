import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Two captures of one purchase must leave one row, never zero.
 *
 * The pipeline inserts first and checks for a duplicate afterwards, because
 * the checks before the insert cannot see a row that has not been written yet.
 * That check used to ask "does another row like this exist?" and withdraw its
 * own insert if one did — fine when the other row was already there, and
 * ruinous when both rows were written in the same instant: both invocations
 * saw the other as pre-existing, both deleted their own row, and the purchase
 * vanished while each side logged that it had avoided a duplicate.
 *
 * Everything below is about the one property that prevents it: both sides pick
 * the survivor by the same rule, applied to the same rows.
 */

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
  registerPlugin: vi.fn(),
}));

vi.mock('@huggingface/transformers', () => ({
  env: { version: '0.0.0-test', backends: { onnx: { wasm: { wasmPaths: '' } } } },
  pipeline: async () => async () => [{ generated_text: '' }],
}));

vi.mock('../supabase', () => ({
  supabase: { from: vi.fn() },
  supabaseUrl: 'https://mock.supabase.co',
  supabaseAnonKey: 'mock-anon-key',
}));

import { decideConcurrentCapture } from '../notificationDuplicates';

const ours = { id: 'bbb', created_at: '2026-08-14T22:10:00.200000+00:00' };
const theirs = { id: 'aaa', created_at: '2026-08-14T22:10:00.100000+00:00' };

describe('reconciling a concurrent double-insert', () => {
  it('rolls back the later insert and names the older row as survivor', () => {
    expect(decideConcurrentCapture([ours, theirs], ours.id)).toEqual({
      kind: 'rollback',
      survivor: theirs,
    });
  });

  it('gives the same answer whichever side is asking', () => {
    // The two invocations read the rows back in whatever order Postgres
    // returns them. The answer cannot depend on that.
    expect(decideConcurrentCapture([ours, theirs], ours.id)).toEqual({
      kind: 'rollback',
      survivor: theirs,
    });
    expect(decideConcurrentCapture([theirs, ours], ours.id)).toEqual({
      kind: 'rollback',
      survivor: theirs,
    });
  });

  it('still picks exactly one when the timestamps are identical', () => {
    const a = { id: 'aaa', created_at: '2026-08-14T22:10:00.000000+00:00' };
    const b = { id: 'bbb', created_at: '2026-08-14T22:10:00.000000+00:00' };
    expect(decideConcurrentCapture([a, b], b.id)).toEqual({ kind: 'rollback', survivor: a });
    expect(decideConcurrentCapture([b, a], b.id)).toEqual({ kind: 'rollback', survivor: a });
  });

  it('picks the oldest of three and rolls back a newer insert', () => {
    const third = { id: 'ccc', created_at: '2026-08-14T22:10:00.300000+00:00' };
    expect(decideConcurrentCapture([ours, theirs, third], third.id)).toEqual({
      kind: 'rollback',
      survivor: theirs,
    });
  });

  it('keeps a lone row', () => {
    expect(decideConcurrentCapture([ours], ours.id)).toEqual({
      kind: 'keep',
      reason: 'only-our-row',
    });
  });

  it('keeps the insert when it is absent from the rows the query returned', () => {
    expect(decideConcurrentCapture([theirs], ours.id)).toEqual({
      kind: 'keep',
      reason: 'insert-not-visible',
    });
  });

  it('keeps the older insert when it is the selected survivor', () => {
    expect(decideConcurrentCapture([ours, theirs], theirs.id)).toEqual({
      kind: 'keep',
      reason: 'insert-survives',
    });
  });
});

/**
 * The call site, read from source: the rollback has to be conditional on
 * losing. A version that deletes whenever any other row exists is the bug.
 */
describe('the post-insert duplicate check', () => {
  const source = readFileSync(resolve(__dirname, '../notificationProcessor.ts'), 'utf8');

  it('reads our own row back rather than excluding it', () => {
    // `.neq('id', transactionId)` on the race check is what made our own row
    // invisible, and with it any way to know whether we were first.
    const raceCheck = source.slice(
      source.indexOf('Step 6b: Post-insert race-recovery'),
      source.indexOf('releasePurchase(purchaseKey);', source.indexOf('Step 6b')),
    );
    expect(raceCheck).not.toMatch(/\.neq\(/);
    expect(raceCheck).toMatch(/decideConcurrentCapture\(sameCharge, transactionId\)/);
  });

  it('only deletes our row when we are not the winner', () => {
    expect(source).toMatch(/if \(decision\.kind === 'rollback'\)/);
  });

  it('keeps our row when we cannot see it to compare', () => {
    expect(decideConcurrentCapture([theirs], ours.id)).toEqual({
      kind: 'keep',
      reason: 'insert-not-visible',
    });
  });
});

/**
 * The other half: the guard that stops the two invocations existing at all.
 * Everything drained from the native queue is marked as a scan, so exempting
 * scans from the purchase claim left the cold-start path unguarded.
 */
describe('the purchase claim', () => {
  const source = readFileSync(resolve(__dirname, '../notificationProcessor.ts'), 'utf8');

  it('applies to a rescan too', () => {
    expect(source).toMatch(/if \(!claimPurchase\(purchaseKey\)\)/);
    expect(source).not.toMatch(/!input\.forceReprocess && !claimPurchase/);
  });

  it('does not permanently mark a notification it merely backed off from', () => {
    const claim = source.slice(
      source.indexOf('if (!claimPurchase(purchaseKey))'),
      source.indexOf('captureConfidence'),
    );
    expect(claim).not.toMatch(/markNotificationProcessed/);
  });
});

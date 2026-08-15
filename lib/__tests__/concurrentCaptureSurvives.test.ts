import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

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

import { pickSurvivingCharge } from '../notificationProcessor';

const ours = { id: 'bbb', created_at: '2026-08-14T22:10:00.200000+00:00' };
const theirs = { id: 'aaa', created_at: '2026-08-14T22:10:00.100000+00:00' };

describe('choosing which row survives a concurrent double-insert', () => {
  it('keeps the older row', () => {
    expect(pickSurvivingCharge([ours, theirs])?.id).toBe('aaa');
  });

  it('gives the same answer whichever side is asking', () => {
    // The two invocations read the rows back in whatever order Postgres
    // returns them. The answer cannot depend on that.
    expect(pickSurvivingCharge([ours, theirs])?.id).toBe(
      pickSurvivingCharge([theirs, ours])?.id,
    );
  });

  it('still picks exactly one when the timestamps are identical', () => {
    const a = { id: 'aaa', created_at: '2026-08-14T22:10:00.000000+00:00' };
    const b = { id: 'bbb', created_at: '2026-08-14T22:10:00.000000+00:00' };
    expect(pickSurvivingCharge([a, b])?.id).toBe('aaa');
    expect(pickSurvivingCharge([b, a])?.id).toBe('aaa');
  });

  it('picks one out of three', () => {
    const third = { id: 'ccc', created_at: '2026-08-14T22:10:00.300000+00:00' };
    expect(pickSurvivingCharge([ours, theirs, third])?.id).toBe('aaa');
  });

  it('keeps a lone row', () => {
    expect(pickSurvivingCharge([ours])?.id).toBe('bbb');
  });

  it('has nothing to say about an empty set', () => {
    expect(pickSurvivingCharge([])).toBeNull();
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
    expect(raceCheck).toMatch(/pickSurvivingCharge/);
  });

  it('only deletes our row when we are not the winner', () => {
    expect(source).toMatch(/if \(winner && winner\.id !== transactionId\)/);
  });

  it('keeps our row when we cannot see it to compare', () => {
    expect(source).toMatch(/if \(ours && others\.length > 0\)/);
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

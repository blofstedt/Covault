/**
 * The notification's own lifecycle, end to end: written onto the row at
 * capture, read back and cleared wherever the row's fate is actually
 * decided. Source-checked because the insert path and every "the user just
 * dealt with this" path live in different files, and a future edit to any
 * one of them silently uncoupling from the others is exactly the failure
 * this exists to catch — the tray would go back to holding a "captured — tap
 * to review" notice for a row that is already filed, ruled out, or gone.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const PROCESSOR = read('lib/notificationProcessor.ts');
const USE_LISTENER = read('lib/hooks/useNotificationListener.ts');
const USE_TX_OPS = read('lib/hooks/useTransactionOps.ts');
const PARSING = read('components/TransactionParsing.tsx');

describe('written at capture', () => {
  it('the id reaches the pipeline input', () => {
    expect(PROCESSOR).toContain('captureNotificationId?: number');
  });

  it('the listener passes the native event\'s id through', () => {
    const idx = USE_LISTENER.indexOf('captureNotificationId: event.capture_notification_id');
    expect(idx).toBeGreaterThan(-1);
  });

  it('the insert embeds it, guarded so a missing id writes nothing', () => {
    expect(PROCESSOR).toContain('withNotificationIdIfKnown(');
    expect(PROCESSOR).toContain('input.captureNotificationId');
    const guard = PROCESSOR.slice(PROCESSOR.indexOf('function withNotificationIdIfKnown'));
    expect(guard.slice(0, 400)).toMatch(/captureNotificationId === undefined/);
  });
});

describe('read back and cleared once the row is dealt with', () => {
  it('deleting a row clears its notification — this is the one path every deletion goes through', () => {
    const idx = USE_TX_OPS.indexOf('clearCaptureNotificationForRows(plan.remove)');
    expect(idx).toBeGreaterThan(-1);
    // Has to run only once the delete actually succeeded, or a failed
    // request would clear a notification for a row that is still there.
    const before = USE_TX_OPS.slice(Math.max(0, idx - 400), idx);
    expect(before).toContain('restore();');
  });

  it('accepting a single caught row clears it', () => {
    const idx = PARSING.indexOf('const handleAcceptCaught');
    expect(idx).toBeGreaterThan(-1);
    const body = PARSING.slice(idx, idx + 1200);
    expect(body).toContain('clearCaptureNotificationForRows([tx])');
  });

  it('bulk-accepting clears every row in the batch', () => {
    const idx = PARSING.indexOf('const handleAcceptMany');
    expect(idx).toBeGreaterThan(-1);
    const body = PARSING.slice(idx, idx + 1200);
    expect(body).toContain('clearCaptureNotificationForRows(txs)');
  });

  it('clearing the whole "to review" card clears every row it held', () => {
    const idx = PARSING.indexOf('const handleClearEntered');
    expect(idx).toBeGreaterThan(-1);
    const body = PARSING.slice(idx, idx + 1200);
    expect(body).toContain('clearCaptureNotificationForRows(rows)');
  });

  it('marking a row "not a transaction" clears it', () => {
    const idx = PARSING.indexOf('const handleMarkNotTransaction');
    expect(idx).toBeGreaterThan(-1);
    const body = PARSING.slice(idx, idx + 500);
    expect(body).toContain('clearCaptureNotificationForRows([tx])');
  });
});

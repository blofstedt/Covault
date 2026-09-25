/**
 * A capture the pipeline fails on is kept for another try, never thrown away.
 *
 * When the pipeline threw, the listener used to fall through to a "legacy"
 * insert of a row with no budget. That insert can only fail, so the user saw
 * a raw database error — and because the handler then returned normally, the
 * hand-off queue released the capture as handled. With tray suppression on,
 * the bank's own alert was already gone, so nothing anywhere could recover it.
 *
 * The queue already knows what to do with a handler that throws: it keeps the
 * entry parked and replays it on the next launch (captureHandoff.test.ts pins
 * that half). This pins the other half — that the listener lets the error
 * reach it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LISTENER = readFileSync(
  resolve(__dirname, '../hooks/useNotificationListener.ts'),
  'utf8',
);

describe('a pipeline error during capture', () => {
  const pipelineCatch = LISTENER.slice(
    LISTENER.indexOf('const result = await processNotificationWithAI('),
    LISTENER.indexOf('// ── Legacy fallback'),
  );

  it('is rethrown, so the hand-off queue keeps the capture parked', () => {
    expect(pipelineCatch.length).toBeGreaterThan(0);
    const catchBlock = pipelineCatch.slice(pipelineCatch.lastIndexOf('} catch (err) {'));
    expect(catchBlock).toContain('throw err;');
  });

  it('frees the re-broadcast window, so the retry is not mistaken for a duplicate', () => {
    const catchBlock = pipelineCatch.slice(pipelineCatch.lastIndexOf('} catch (err) {'));
    expect(catchBlock).toContain('recentListenerEvents.splice(attempt, 1)');
    expect(catchBlock.indexOf('recentListenerEvents.splice')).toBeLessThan(
      catchBlock.indexOf('throw err;'),
    );
  });

  it('never reaches the budget-less legacy insert', () => {
    // The only way to the legacy insert is now a notification with no text to
    // parse; a pipeline failure cannot fall through to it.
    const catchBlock = pipelineCatch.slice(pipelineCatch.lastIndexOf('} catch (err) {'));
    expect(catchBlock).not.toMatch(/falling back to legacy/);
  });

  it('does not leave a live broadcast as an unhandled rejection', () => {
    // A live event's retry is its copy in the native queue, drained later.
    expect(LISTENER).toContain('void handleEvent(event).catch(() => {});');
  });
});

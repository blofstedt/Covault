import { describe, it, expect } from 'vitest';
import {
  parseCaptureOutcomes,
  isCaptureProblem,
  describeCaptureOutcome,
  captureProblemHeadline,
  captureOutcomeLabel,
  captureOutcomeAdvice,
  captureOutcomeAppName,
  type CaptureOutcomeCode,
} from '../captureOutcome';

/**
 * Tray suppression has six ways to decline, and in the tray they are
 * indistinguishable — the alert simply stays. That is what made "it still
 * isn't hiding them" cost a release per guess. The native listener now records
 * which gate stopped each alert; this is the layer that turns that into
 * something readable, so what it must never do is lose or mislabel an entry.
 */

const ALL: CaptureOutcomeCode[] = [
  'hidden',
  'blocked',
  'not_saved',
  'toggle_off',
  'no_amount',
  'not_clearable',
  'cancel_ignored',
];

describe('parseCaptureOutcomes', () => {
  it('reads what the native side writes, newest first', () => {
    // The listener appends, so the last entry is the most recent one.
    const raw = JSON.stringify([
      { key: 'a', at: 1, app: 'com.bmo.mobile', amount: 12.5, outcome: 'hidden' },
      { key: 'b', at: 2, app: 'com.wealthsimple', amount: 4, outcome: 'blocked' },
    ]);
    const parsed = parseCaptureOutcomes(raw);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({
      at: 2,
      app: 'com.wealthsimple',
      amount: 4,
      outcome: 'blocked',
    });
  });

  it('accepts an already-parsed array', () => {
    const parsed = parseCaptureOutcomes([{ at: 1, app: 'x', outcome: 'hidden' }]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].amount).toBeNull();
  });

  it('drops rows with an outcome it does not recognise', () => {
    // A newer APK could record a reason this build has never heard of. It must
    // be skipped rather than rendered as an empty warning the user can't act on.
    const parsed = parseCaptureOutcomes(
      JSON.stringify([
        { at: 1, app: 'a', outcome: 'something_new' },
        { at: 2, app: 'b', outcome: 'hidden' },
      ]),
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0].outcome).toBe('hidden');
  });

  it('survives malformed input rather than taking the screen down with it', () => {
    // This is a diagnostic. One that throws breaks the settings page it exists
    // to explain, which is strictly worse than showing nothing.
    expect(parseCaptureOutcomes('not json')).toEqual([]);
    expect(parseCaptureOutcomes('{}')).toEqual([]);
    expect(parseCaptureOutcomes(null)).toEqual([]);
    expect(parseCaptureOutcomes(undefined)).toEqual([]);
    expect(parseCaptureOutcomes(JSON.stringify([null, 3, 'x']))).toEqual([]);
  });

  it('treats a missing or non-numeric amount as no amount', () => {
    const parsed = parseCaptureOutcomes(
      JSON.stringify([{ at: 1, app: 'a', amount: 'lots', outcome: 'no_amount' }]),
    );
    expect(parsed[0].amount).toBeNull();
  });
});

describe('isCaptureProblem', () => {
  it('does not call the feature working a problem', () => {
    expect(isCaptureProblem('hidden')).toBe(false);
  });

  it('does not nag about the user’s own choice', () => {
    // The toggle being off is a decision, not a fault. Warning about it would
    // be arguing with the user.
    expect(isCaptureProblem('toggle_off')).toBe(false);
  });

  it('does not warn about an alert that carried no amount', () => {
    // A balance warning or a login alert. Hiding those was never the intent,
    // so leaving one in the tray is correct behaviour, not a failure.
    expect(isCaptureProblem('no_amount')).toBe(false);
  });

  it('flags every outcome the user could act on', () => {
    expect(isCaptureProblem('blocked')).toBe(true);
    expect(isCaptureProblem('not_saved')).toBe(true);
    expect(isCaptureProblem('not_clearable')).toBe(true);
    expect(isCaptureProblem('cancel_ignored')).toBe(true);
  });
});

describe('wording', () => {
  it('has a description for every outcome', () => {
    for (const outcome of ALL) {
      expect(describeCaptureOutcome(outcome).length).toBeGreaterThan(0);
    }
  });

  it('has a headline for every outcome', () => {
    for (const outcome of ALL) {
      expect(captureProblemHeadline(outcome).length).toBeGreaterThan(0);
    }
  });

  it('labels a row by its verdict', () => {
    expect(captureOutcomeLabel('hidden')).toBe('Hidden');
    expect(captureOutcomeLabel('cancel_ignored')).toBe('Kept');
  });

  it('offers advice exactly where there is something to do', () => {
    expect(captureOutcomeAdvice('blocked')).not.toBeNull();
    expect(captureOutcomeAdvice('not_saved')).not.toBeNull();
    expect(captureOutcomeAdvice('cancel_ignored')).not.toBeNull();
    // Nothing to change, so promise nothing.
    expect(captureOutcomeAdvice('hidden')).toBeNull();
    expect(captureOutcomeAdvice('toggle_off')).toBeNull();
    expect(captureOutcomeAdvice('no_amount')).toBeNull();
  });

  it('names the bank rather than its package', () => {
    expect(captureOutcomeAppName('com.bmo.mobile')).toBe('BMO');
  });

  it('falls back to the package for an app it does not know', () => {
    expect(captureOutcomeAppName('com.example.unknown')).toBe('com.example.unknown');
    expect(captureOutcomeAppName('')).toBe('A bank app');
  });
});

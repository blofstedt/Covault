import { describe, it, expect } from 'vitest';
import { captureHealth, agoLabel, heardFrom } from '../captureHealth';
import type { CaptureHealthInput } from '../captureHealth';
import type { CaptureOutcome } from '../captureOutcome';

/**
 * "A purchase didn't appear" had no answer short of guessing.
 *
 * There are about five reasons, and the user cannot tell them apart: access
 * revoked, Covault's own notifications switched off, no apps chosen, a bank
 * that has gone quiet, or a rule they wrote a month ago. Every one of those is
 * already observable on the phone — none of this is new information, it is
 * information that was scattered across a settings screen, a heartbeat file
 * and a native ring buffer.
 *
 * The card reads the phone; this decides what the answer IS, which is the half
 * that can be tested without one.
 */

const NOW = Date.parse('2026-09-13T12:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const healthy = (over: Partial<CaptureHealthInput> = {}): CaptureHealthInput => ({
  captureEnabled: true,
  listenerGranted: true,
  canPostNotifications: true,
  monitoredCount: 3,
  lastSeen: { 'com.rbc.mobile.android': NOW - 3 * MIN },
  silent: [],
  outcomes: [],
  now: NOW,
  ...over,
});

describe('the verdict', () => {
  it('says it is working, and when it last heard anything', () => {
    const health = captureHealth(healthy());
    expect(health.level).toBe('ok');
    expect(health.headline).toContain('3 min ago');
  });

  it('leads with the thing that breaks capture most completely', () => {
    // Access is first because nothing arrives at all without it. Posting is
    // second: captures still happen, silently.
    const health = captureHealth(healthy({
      listenerGranted: false,
      canPostNotifications: false,
      monitoredCount: 0,
    }));
    expect(health.level).toBe('attention');
    expect(health.headline).toContain('Notification access');
  });

  it('is honest that captures still happen when only the notification is off', () => {
    const health = captureHealth(healthy({ canPostNotifications: false }));
    const check = health.checks.find((c) => c.key === 'notifications')!;
    expect(check.ok).toBe(false);
    expect(check.detail).toContain('still captured');
  });

  it('names the silent banks rather than claiming capture is broken', () => {
    // A bank goes quiet because of ITS notification settings, which Covault
    // cannot read — so this is worded as an observation and offers no button.
    const health = captureHealth(healthy({ silent: ['com.bmo.mobile'] }));
    const check = health.checks.find((c) => c.key === 'heard')!;
    expect(check.ok).toBe(false);
    expect(check.detail).toContain('quiet');
    expect(check.fix).toBeUndefined();
  });

  it('says so plainly when capture is switched off, rather than crying fault', () => {
    const health = captureHealth(healthy({ captureEnabled: false }));
    expect(health.level).toBe('off');
    expect(health.headline).toContain('switched off');
  });

  it('offers a way to fix each thing that has one', () => {
    const health = captureHealth(healthy({
      listenerGranted: false,
      canPostNotifications: false,
      monitoredCount: 0,
    }));
    expect(health.checks.find((c) => c.key === 'access')!.fix).toBe('access');
    expect(health.checks.find((c) => c.key === 'notifications')!.fix).toBe('notifications');
    expect(health.checks.find((c) => c.key === 'sources')!.fix).toBe('sources');
  });

  it('lists only the alerts that became no purchase', () => {
    // A list of successes is a list nobody reads, and the question is always
    // about the one that is missing. An alert that WAS captured and merely not
    // hidden afterwards does not belong here — that is a different question,
    // and the settings screen asks it.
    const outcomes: CaptureOutcome[] = [
      { at: NOW - MIN, app: 'com.rbc.mobile.android', amount: 42.17, outcome: 'hidden' },
      { at: NOW - 2 * MIN, app: 'com.rbc.mobile.android', amount: 9.99, outcome: 'toggle_off' },
      { at: NOW - 3 * MIN, app: 'com.td', amount: null, outcome: 'no_amount' },
      { at: NOW - 4 * MIN, app: 'com.bmo.mobile', amount: 2400, outcome: 'income' },
    ];
    const health = captureHealth(healthy({ outcomes }));
    expect(health.uncaptured.map((row) => row.entry.outcome)).toEqual(['no_amount', 'income']);
  });

  it('tells Covault deciding apart from Covault failing', () => {
    // Refusing a deposit is the app working. Failing to save is not, and only
    // one of them should make a healthy install look broken.
    const outcomes: CaptureOutcome[] = [
      { at: NOW - MIN, app: 'com.bmo.mobile', amount: 2400, outcome: 'income' },
      { at: NOW - 2 * MIN, app: 'com.td', amount: 31.5, outcome: 'not_saved' },
    ];
    const rows = captureHealth(healthy({ outcomes })).uncaptured;
    expect(rows.find((r) => r.entry.outcome === 'income')!.fault).toBe(false);
    expect(rows.find((r) => r.entry.outcome === 'not_saved')!.fault).toBe(true);
  });

  it('says which of the user own rules hid something', () => {
    // The case with no other explanation anywhere: a skip pattern written a
    // month ago, quietly doing its job.
    const outcomes: CaptureOutcome[] = [
      { at: NOW - MIN, app: 'com.rbc.mobile.android', amount: 4.5, outcome: 'user_ignored' },
    ];
    expect(captureHealth(healthy({ outcomes })).uncaptured[0].reason)
      .toContain('skip pattern you wrote');
  });

  it('is still "working" when a captured alert simply was not hidden', () => {
    // Tray suppression declining is not capture failing. The purchase is on
    // the books either way, and conflating the two would send someone hunting
    // a problem they do not have.
    const outcomes: CaptureOutcome[] = [
      { at: NOW - MIN, app: 'com.rbc.mobile.android', amount: 42.17, outcome: 'toggle_off' },
    ];
    expect(captureHealth(healthy({ outcomes })).level).toBe('ok');
  });
});

describe('how long ago', () => {
  it('reads the way a person would say it', () => {
    expect(agoLabel(NOW - 20_000, NOW)).toBe('just now');
    expect(agoLabel(NOW - 3 * MIN, NOW)).toBe('3 min ago');
    expect(agoLabel(NOW - HOUR, NOW)).toBe('1 hr ago');
    expect(agoLabel(NOW - 5 * HOUR, NOW)).toBe('5 hrs ago');
    expect(agoLabel(NOW - DAY, NOW)).toBe('yesterday');
    expect(agoLabel(NOW - 4 * DAY, NOW)).toBe('4 days ago');
  });

  it('never reads as the future when the phone clock is behind', () => {
    expect(agoLabel(NOW + 5 * MIN, NOW)).toBe('just now');
  });
});

describe('who has been heard from', () => {
  it('is most recent first', () => {
    const order = heardFrom({ a: NOW - HOUR, b: NOW - MIN, c: NOW - DAY });
    expect(order.map((row) => row.app)).toEqual(['b', 'a', 'c']);
  });

  it('drops entries with no usable time rather than showing 1970', () => {
    const rows = heardFrom({ a: 0, b: Number.NaN as unknown as number, c: NOW });
    expect(rows.map((row) => row.app)).toEqual(['c']);
  });
});

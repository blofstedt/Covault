/**
 * The only route from "nothing happened" to something fixable.
 *
 * A purchase the parser never recognised leaves no row, no notification, and
 * no trace anywhere in the app — the single biggest coverage risk on a
 * stranger's bank, whose alerts were never seen while this app was written.
 * These pin two things: that the report actually carries the diagnostic
 * context that makes it actionable, and that it never carries a transaction,
 * a vendor, or the text of any bank alert — the same line lib/errorReporting
 * draws, for the same reason.
 */
import { describe, it, expect } from 'vitest';
import { buildMissedAlertBody, buildMissedAlertReportUrl, MISSED_ALERT_SUBJECT } from '../missedAlertReport';
import type { CaptureOutcome } from '../captureOutcome';

const outcome = (over: Partial<CaptureOutcome> = {}): CaptureOutcome => ({
  at: 1_700_000_000_000,
  app: 'com.bmo.mobile',
  amount: 12.34,
  outcome: 'hidden',
  ...over,
});

describe('buildMissedAlertBody', () => {
  it('leaves room for the one fact only the user has', () => {
    const body = buildMissedAlertBody({
      captureEnabled: true,
      monitoredBankNames: ['BMO'],
      recentOutcomes: [],
      versionCode: 42,
    });
    expect(body).toMatch(/paste or describe/i);
  });

  it('reports whether capture is actually switched on', () => {
    expect(
      buildMissedAlertBody({ captureEnabled: true, monitoredBankNames: [], recentOutcomes: [], versionCode: 1 }),
    ).toMatch(/capture switched on: yes/i);
    expect(
      buildMissedAlertBody({ captureEnabled: false, monitoredBankNames: [], recentOutcomes: [], versionCode: 1 }),
    ).toMatch(/capture switched on: no/i);
  });

  it('names which banks are being watched', () => {
    const body = buildMissedAlertBody({
      captureEnabled: true,
      monitoredBankNames: ['BMO', 'Scotiabank'],
      recentOutcomes: [],
      versionCode: 1,
    });
    expect(body).toContain('BMO, Scotiabank');
  });

  it('says so plainly when nothing is being watched at all', () => {
    // The single most likely reason a purchase went uncaught, so it has to
    // be legible on its own rather than reading as an empty list.
    const body = buildMissedAlertBody({
      captureEnabled: true,
      monitoredBankNames: [],
      recentOutcomes: [],
      versionCode: 1,
    });
    expect(body).toMatch(/watching: nothing selected/i);
  });

  it('includes the build number, so a fix can be dated against it', () => {
    expect(
      buildMissedAlertBody({ captureEnabled: true, monitoredBankNames: [], recentOutcomes: [], versionCode: 217 }),
    ).toContain('217');
  });

  it('says "web" rather than a made-up number off-device', () => {
    expect(
      buildMissedAlertBody({ captureEnabled: true, monitoredBankNames: [], recentOutcomes: [], versionCode: null }),
    ).toMatch(/unknown \(web\)/i);
  });

  it('summarises recent capture activity in readable terms', () => {
    const body = buildMissedAlertBody({
      captureEnabled: true,
      monitoredBankNames: [],
      recentOutcomes: [outcome({ outcome: 'hidden', amount: 45.5 })],
      versionCode: 1,
    });
    expect(body).toContain('$45.50');
    expect(body).toMatch(/hidden after capture/i);
  });

  it('caps how many recent outcomes are shown', () => {
    const many = Array.from({ length: 20 }, (_, i) => outcome({ at: 1_700_000_000_000 + i }));
    const body = buildMissedAlertBody({
      captureEnabled: true,
      monitoredBankNames: [],
      recentOutcomes: many,
      versionCode: 1,
    });
    // Outcome lines are the only ones indented two spaces — the prose above
    // them uses an em dash too, which a looser filter mistook for one.
    const shown = body.split('\n').filter((line) => line.startsWith('  ')).length;
    expect(shown).toBeLessThanOrEqual(5);
  });

  it('says so when nothing has been captured yet, rather than an empty section', () => {
    const body = buildMissedAlertBody({
      captureEnabled: true,
      monitoredBankNames: [],
      recentOutcomes: [],
      versionCode: 1,
    });
    expect(body).toMatch(/nothing recorded yet/i);
  });

  it('never carries an amount from any OTHER part of the app, only from the diagnostics it was given', () => {
    // Guards against a future edit accidentally threading a real transaction
    // or vendor name into this function's inputs. What it receives is what it
    // prints — nothing here reads global or app state on its own.
    const body = buildMissedAlertBody({
      captureEnabled: true,
      monitoredBankNames: ['Amex'],
      recentOutcomes: [outcome({ amount: null })],
      versionCode: 1,
    });
    expect(body).toContain('no amount read');
  });
});

describe('buildMissedAlertReportUrl', () => {
  it('is a mailto link with the report subject', () => {
    const url = buildMissedAlertReportUrl({
      captureEnabled: true,
      monitoredBankNames: [],
      recentOutcomes: [],
      versionCode: 1,
    });
    expect(url).toMatch(/^mailto:/);
    expect(url).toContain(encodeURIComponent(MISSED_ALERT_SUBJECT));
  });

  it('percent-encodes the body so newlines survive as a mailto URL', () => {
    const url = buildMissedAlertReportUrl({
      captureEnabled: true,
      monitoredBankNames: ['BMO'],
      recentOutcomes: [],
      versionCode: 1,
    });
    expect(url).not.toMatch(/\n/);
    expect(url).toContain('body=');
  });
});

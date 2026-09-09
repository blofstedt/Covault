/**
 * Which Android notification announced a row, carried on the row itself so
 * it can be found again once the user deals with the row from inside the
 * app — see lib/captureNotificationMarker.ts for why this is a marker in the
 * text rather than a column.
 */
import { describe, it, expect } from 'vitest';
import {
  withCaptureNotificationMarker,
  readCaptureNotificationMarker,
  stripCaptureNotificationMarker,
} from '../captureNotificationMarker';
import { stripCaptureBookkeeping } from '../captureChannel';

describe('withCaptureNotificationMarker / readCaptureNotificationMarker', () => {
  it('round-trips a positive id', () => {
    const text = withCaptureNotificationMarker('You spent $12.34 at Costco', 123456);
    expect(readCaptureNotificationMarker(text)).toBe(123456);
  });

  it('round-trips a negative id', () => {
    // Android notification ids here come from String.hashCode(), a signed
    // 32-bit int that is commonly negative — this is the ordinary case, not
    // an edge case.
    const text = withCaptureNotificationMarker('You spent $12.34 at Costco', -987654321);
    expect(readCaptureNotificationMarker(text)).toBe(-987654321);
  });

  it('is null on text with no marker', () => {
    expect(readCaptureNotificationMarker('You spent $12.34 at Costco')).toBeNull();
  });

  it('is null on empty or missing text', () => {
    expect(readCaptureNotificationMarker('')).toBeNull();
    expect(readCaptureNotificationMarker(null)).toBeNull();
    expect(readCaptureNotificationMarker(undefined)).toBeNull();
  });

  it('replaces an earlier marker rather than accumulating a second one', () => {
    const once = withCaptureNotificationMarker('You spent $12.34 at Costco', 111);
    const twice = withCaptureNotificationMarker(once, 222);
    expect(readCaptureNotificationMarker(twice)).toBe(222);
    expect(twice.match(/covault:notif-id/g)?.length).toBe(1);
  });
});

describe('stripCaptureNotificationMarker', () => {
  it('removes the marker and leaves the rest of the text intact', () => {
    const original = 'You spent $12.34 at Costco';
    const marked = withCaptureNotificationMarker(original, 42);
    expect(stripCaptureNotificationMarker(marked)).toBe(original);
  });

  it('is a no-op on text with no marker', () => {
    expect(stripCaptureNotificationMarker('You spent $12.34 at Costco')).toBe(
      'You spent $12.34 at Costco',
    );
  });
});

describe('coexistence with the other markers already on a row', () => {
  it('does not interfere with stripCaptureBookkeeping stripping the other two', () => {
    // The three markers ride the same field. This one must not stop the
    // other two — or itself — from being fully removed when the raw text is
    // shown to a user.
    const text = withCaptureNotificationMarker(
      'You spent $12.34 at Costco\n<!-- covault:capture channel=bank pkg=com.costco.app -->\n<!-- covault:email-paired -->',
      999,
    );
    expect(stripCaptureBookkeeping(text)).toBe('You spent $12.34 at Costco');
  });

  it('never contains a dollar figure, so it cannot confuse an amount scan of the raw text', () => {
    const text = withCaptureNotificationMarker('You spent $12.34 at Costco', 555);
    const markerOnly = text.slice(text.indexOf('<!--'));
    expect(markerOnly).not.toMatch(/\$/);
  });
});

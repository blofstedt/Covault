import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AUTO_ACCEPT_MIN_CONFIDENCE } from '../vendorMatchConfidence';

/**
 * The widget's review badge has to predict what the JS pipeline will do with a
 * capture made while the app was closed: file it automatically, or leave it in
 * Review. That means the native side needs the auto-file threshold, which now
 * exists in both TypeScript and Java.
 *
 * Drift here is quiet and annoying in both directions. Too low on the Java
 * side and the badge under-reports, defeating the entire point of a backstop
 * for a mis-dismissed notification. Too high and it shows a phantom item after
 * every matched purchase until the app is next opened, which teaches the user
 * to ignore it.
 *
 * Same guard shape as widgetPalette.test.ts.
 */

const JAVA = resolve(__dirname, '../../android-custom/WidgetDeltaStore.java');

function parseJavaThreshold(): number {
  const source = readFileSync(JAVA, 'utf8');
  const begin = source.indexOf('// AUTO_FILE_THRESHOLD_BEGIN');
  const end = source.indexOf('// AUTO_FILE_THRESHOLD_END');
  expect(begin, 'AUTO_FILE_THRESHOLD_BEGIN marker missing').toBeGreaterThan(-1);
  expect(end, 'AUTO_FILE_THRESHOLD_END marker missing').toBeGreaterThan(begin);

  const block = source.slice(begin, end);
  const match = /AUTO_FILE_THRESHOLD\s*=\s*([0-9.]+)\s*;/.exec(block);
  expect(match, 'could not parse AUTO_FILE_THRESHOLD out of the Java').not.toBeNull();
  return Number.parseFloat(match![1]);
}

describe('widget auto-file threshold', () => {
  it('parses a plausible number out of the Java', () => {
    // Guards the parser itself — a regex matching nothing would make the
    // comparison below vacuous.
    const value = parseJavaThreshold();
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThanOrEqual(1);
  });

  it('matches AUTO_ACCEPT_MIN_CONFIDENCE exactly', () => {
    expect(parseJavaThreshold()).toBe(AUTO_ACCEPT_MIN_CONFIDENCE);
  });
});

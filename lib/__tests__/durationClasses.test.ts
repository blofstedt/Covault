import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * `duration-250` is not a class Tailwind generates, and asking for it does not
 * fail — it emits nothing, so the element quietly falls back to the 150ms
 * baked into `transition-*` or to tailwindcss-animate's own default.
 *
 * That is exactly how the transaction form ended up opening over 300ms and
 * closing in a blink that did not read as a fade at all, and how two action
 * sheets ended up running at a speed nobody chose. Nothing catches it: the
 * build is green, the class is in the markup, and only the motion is wrong.
 *
 * Same family as the tailwindcss-animate invariant in tailwind.config.js — a
 * styling mistake that is invisible everywhere except on the phone.
 */

/** Tailwind's default transitionDuration scale, plus the delay scale. */
const ALLOWED = new Set([0, 75, 100, 150, 200, 300, 500, 700, 1000]);

const ROOT = resolve(__dirname, '../..');
const SEARCH_DIRS = ['components', 'lib'];
const EXTENSIONS = ['.ts', '.tsx'];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__') sourceFiles(full, out);
    } else if (EXTENSIONS.some(ext => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

const files = [
  resolve(ROOT, 'App.tsx'),
  ...SEARCH_DIRS.flatMap(dir => sourceFiles(resolve(ROOT, dir))),
];

/**
 * `duration-300` and `delay-150`, but not `duration-[320ms]` (an arbitrary
 * value, which Tailwind does generate) and not the tail of an identifier.
 */
const SCALED = /(?<![-\w])(duration|delay)-(\d+)\b/g;

describe('transition durations and delays', () => {
  it('only ask for values Tailwind actually generates', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const lines = source.split('\n');
      lines.forEach((line, i) => {
        for (const match of line.matchAll(SCALED)) {
          const value = Number(match[2]);
          if (ALLOWED.has(value)) continue;
          offenders.push(
            `${relative(ROOT, file)}:${i + 1} uses ${match[0]}, which emits no CSS. ` +
            `Use one of ${[...ALLOWED].join(', ')}, or write it as ` +
            `${match[1]}-[${value}ms].`,
          );
        }
      });
    }

    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('is actually looking at the app', () => {
    // A regex that matched nothing would pass the test above forever.
    expect(files.length).toBeGreaterThan(30);
    expect(
      files.some(f => readFileSync(f, 'utf8').includes('duration-300')),
    ).toBe(true);
  });
});

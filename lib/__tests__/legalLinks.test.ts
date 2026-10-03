import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { Capacitor } from '@capacitor/core';
import { DEPLOYED_ORIGIN, getLegalLinkHref } from '../legalLinks';

const ROOT = resolve(__dirname, '../..');

function collectFiles(dir: string, fileList: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectFiles(full, fileList);
    } else {
      fileList.push(full);
    }
  }
  return fileList;
}

describe('legalLinks', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getLegalLinkHref', () => {
    it('returns root-relative paths on the web platform', () => {
      vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);

      expect(getLegalLinkHref('/privacy')).toBe('/privacy');
      expect(getLegalLinkHref('/terms')).toBe('/terms');
      expect(getLegalLinkHref('/delete')).toBe('/delete');
      expect(getLegalLinkHref('privacy')).toBe('/privacy');
      expect(getLegalLinkHref('terms')).toBe('/terms');
    });

    it('returns absolute deployed URLs on native Capacitor platforms', () => {
      vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);

      expect(getLegalLinkHref('/privacy')).toBe(`${DEPLOYED_ORIGIN}/privacy`);
      expect(getLegalLinkHref('/terms')).toBe(`${DEPLOYED_ORIGIN}/terms`);
      expect(getLegalLinkHref('/delete')).toBe(`${DEPLOYED_ORIGIN}/delete`);
      expect(getLegalLinkHref('privacy')).toBe(`${DEPLOYED_ORIGIN}/privacy`);
      expect(DEPLOYED_ORIGIN).toBe('https://covaultbudgeting.vercel.app');
    });
  });

  describe('deployed origin guard', () => {
    it('ensures vercel.app is not hard-coded anywhere outside lib/legalLinks.ts and test files', () => {
      const pathsToScan = [
        ...collectFiles(join(ROOT, 'components')),
        ...collectFiles(join(ROOT, 'lib')),
        join(ROOT, 'App.tsx'),
        join(ROOT, 'index.tsx'),
        join(ROOT, 'index.html'),
      ];

      const violations: string[] = [];

      for (const filePath of pathsToScan) {
        const rel = relative(ROOT, filePath);
        // Exclude test files, test directories, and lib/legalLinks.ts
        if (
          rel === 'lib/legalLinks.ts' ||
          rel.includes('__tests__') ||
          /\.(test|spec)\.[jt]sx?$/.test(rel)
        ) {
          continue;
        }

        const content = readFileSync(filePath, 'utf8');
        if (content.includes('vercel.app')) {
          violations.push(rel);
        }
      }

      expect(
        violations,
        `Found hard-coded vercel.app reference in: ${violations.join(', ')}. Use getLegalLinkHref from lib/legalLinks.ts and root-relative paths instead of hard-coding the deployed origin.`,
      ).toEqual([]);
    });
  });
});

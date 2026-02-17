import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Mock @capacitor/core so bankingApps.ts doesn't fail
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
  registerPlugin: vi.fn(),
}));

import { vi } from 'vitest';
import { KNOWN_BANKING_APPS } from '../bankingApps';

/**
 * Parse the BANKING_APPS set from NotificationListener.java.
 * Extracts all quoted package names from the Java HashSet initializer.
 */
function parseJavaBankingApps(): Set<string> {
  const javaPath = resolve(__dirname, '../../android-custom/NotificationListener.java');
  const content = readFileSync(javaPath, 'utf-8');

  // Find the BANKING_APPS set block
  const setMatch = content.match(
    /static final Set<String> BANKING_APPS = new HashSet<>\(Arrays\.asList\(([\s\S]*?)\)\);/,
  );
  if (!setMatch) {
    throw new Error('Could not find BANKING_APPS set in NotificationListener.java');
  }

  const block = setMatch[1];
  const packageNames = new Set<string>();
  const regex = /"([^"]+)"/g;
  let match;
  while ((match = regex.exec(block)) !== null) {
    packageNames.add(match[1]);
  }
  return packageNames;
}

describe('Banking apps consistency (Java ↔ TypeScript)', () => {
  const javaBankingApps = parseJavaBankingApps();
  const tsBankingApps = new Set(Object.keys(KNOWN_BANKING_APPS));

  it('Java BANKING_APPS set is non-empty', () => {
    expect(javaBankingApps.size).toBeGreaterThan(0);
  });

  it('TypeScript KNOWN_BANKING_APPS is non-empty', () => {
    expect(tsBankingApps.size).toBeGreaterThan(0);
  });

  it('every TypeScript known app exists in the Java hardcoded set', () => {
    const missingInJava: string[] = [];
    for (const pkg of tsBankingApps) {
      if (!javaBankingApps.has(pkg)) {
        missingInJava.push(pkg);
      }
    }
    expect(
      missingInJava,
      `These TS apps are missing from Java BANKING_APPS:\n  ${missingInJava.join('\n  ')}`,
    ).toEqual([]);
  });

  it('every Java hardcoded app exists in the TypeScript known apps', () => {
    const missingInTS: string[] = [];
    for (const pkg of javaBankingApps) {
      if (!tsBankingApps.has(pkg)) {
        missingInTS.push(pkg);
      }
    }
    expect(
      missingInTS,
      `These Java apps are missing from TS KNOWN_BANKING_APPS:\n  ${missingInTS.join('\n  ')}`,
    ).toEqual([]);
  });
});

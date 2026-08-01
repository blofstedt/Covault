import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Mock @capacitor/core so bankingApps.ts doesn't fail
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
  registerPlugin: vi.fn(),
}));

import { KNOWN_BANKING_APPS, EXCLUDED_APPS, isExcludedApp } from '../bankingApps';

const JAVA_PATH = resolve(__dirname, '../../android-custom/NotificationListener.java');

/**
 * Parse a `static final Set<String> <name>` block from NotificationListener.java.
 * Extracts all quoted package names from the Java HashSet initializer.
 */
function parseJavaPackageSet(setName: string): Set<string> {
  const content = readFileSync(JAVA_PATH, 'utf-8');

  const setMatch = content.match(
    new RegExp(
      `static final Set<String> ${setName} = new HashSet<>\\(Arrays\\.asList\\(([\\s\\S]*?)\\)\\);`,
    ),
  );
  if (!setMatch) {
    throw new Error(`Could not find ${setName} set in NotificationListener.java`);
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

function parseJavaBankingApps(): Set<string> {
  return parseJavaPackageSet('BANKING_APPS');
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

/**
 * The exclusion list is the only thing standing between the app and Google
 * Wallet's duplicate of every tap-to-pay purchase. It has to hold on BOTH
 * sides: Java is where the notification is actually dropped, TypeScript is the
 * backstop for queued events and rescans. If the two drift, one path silently
 * starts capturing again — exactly the failure mode this whole area keeps
 * hitting.
 */
describe('Excluded apps consistency (Java ↔ TypeScript)', () => {
  const javaExcluded = parseJavaPackageSet('EXCLUDED_APPS');
  const tsExcluded = new Set(Object.keys(EXCLUDED_APPS));

  it('both sides list exactly the same packages', () => {
    expect([...javaExcluded].sort()).toEqual([...tsExcluded].sort());
  });

  it('excludes Google Wallet', () => {
    expect(tsExcluded.has('com.google.android.apps.walletnfcrel')).toBe(true);
    expect(javaExcluded.has('com.google.android.apps.walletnfcrel')).toBe(true);
  });

  it('never excludes an app that is also a known bank', () => {
    const overlap = [...tsExcluded].filter((pkg) => pkg in KNOWN_BANKING_APPS);
    expect(
      overlap,
      `These packages are both a known bank and excluded, which is contradictory:\n  ${overlap.join('\n  ')}`,
    ).toEqual([]);
  });

  it('isExcludedApp matches the list, and tolerates junk input', () => {
    expect(isExcludedApp('com.google.android.apps.walletnfcrel')).toBe(true);
    expect(isExcludedApp('  com.google.android.apps.wallet  ')).toBe(true);
    expect(isExcludedApp('com.bmo.mobile')).toBe(false);
    expect(isExcludedApp('')).toBe(false);
    expect(isExcludedApp(null)).toBe(false);
    expect(isExcludedApp(undefined)).toBe(false);
  });

  it('does not treat inherited Object properties as excluded', () => {
    // `EXCLUDED_APPS` is a plain object, so a naive `EXCLUDED_APPS[pkg]` lookup
    // would report "constructor" and "toString" as excluded packages.
    expect(isExcludedApp('constructor')).toBe(false);
    expect(isExcludedApp('toString')).toBe(false);
  });

  it('Java drops excluded packages before the has-a-dollar-amount fallback', () => {
    const content = readFileSync(JAVA_PATH, 'utf-8');

    const excludedCheck = content.indexOf('EXCLUDED_APPS.contains(packageName)');
    const dollarFallback = content.indexOf('!fromMonitored && !hasDollarAmount');

    expect(excludedCheck, 'EXCLUDED_APPS check missing from NotificationListener').toBeGreaterThan(-1);
    expect(dollarFallback, 'dollar-amount fallback missing from NotificationListener').toBeGreaterThan(-1);
    expect(
      excludedCheck,
      'The exclusion check must come BEFORE the `hasDollarAmount` fallback — that ' +
      'fallback forwards ANY app mentioning a dollar amount, which is how Google ' +
      'Wallet got in despite never being on a banking list.',
    ).toBeLessThan(dollarFallback);
  });
});
